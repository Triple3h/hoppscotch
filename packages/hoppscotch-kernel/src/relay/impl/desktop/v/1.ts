import type { VersionedAPI } from "@type/versioning"
import {
  type RelayV1,
  type RelayRequest,
  type RelayRequestEvents,
  type RelayEventEmitter,
  type RelayResponse,
  type RelayError,
  type StatusCode,
  type Version,
  body,
  relayRequestToNativeAdapter,
} from "@relay/v/1"
import * as E from "fp-ts/Either"
import { invoke, transformCallback } from "@tauri-apps/api/core"

/**
 * Wire types mirroring `tauri-plugin-relay`'s serde payloads
 * (`models.rs` in the plugin). The kernel speaks to the plugin directly
 * through `invoke` so streaming events can ride along on a Tauri
 * `Channel` — the packaged `@hoppscotch/plugin-relay` guest bindings
 * predate the event channel and only expose the one-shot `execute`.
 */
type WireRequestResult =
  | { kind: "success"; response: WireResponse }
  | { kind: "error"; error: RelayError }

type WireResponse = {
  id: number
  status: StatusCode
  statusText: string
  version: Version
  headers: Record<string, string>
  cookies: Array<{
    name: string
    value: string
    domain?: string
    path?: string
    expires?: string
    secure?: boolean
    httpOnly?: boolean
    sameSite?: "Strict" | "Lax" | "None"
  }> | null
  body: { body: Uint8Array; mediaType: string }
  meta: {
    timing: { start: number; end: number }
    size: { headers: number; body: number; total: number }
  }
}

type WireStreamEvent =
  | {
      type: "headers"
      requestId: number
      status: number
      statusText: string
      headers: Record<string, string>
    }
  | { type: "chunk"; requestId: number; data: string }

/**
 * Minimal event hub implementing `RelayEventEmitter`. The desktop relay
 * only ever emits `headersReceived`/`chunk` (streaming response bodies),
 * but the hub stays generic per the `RelayV1` contract.
 */
class RelayEventHub implements RelayEventEmitter<RelayRequestEvents> {
  private handlers = new Map<string, Set<(payload: never) => void>>()

  on<K extends keyof RelayRequestEvents>(
    event: K,
    handler: (payload: RelayRequestEvents[K]) => void
  ): () => void {
    let set = this.handlers.get(event as string)
    if (!set) {
      set = new Set()
      this.handlers.set(event as string, set)
    }
    set.add(handler as (payload: never) => void)
    return () => this.off(event, handler)
  }

  once<K extends keyof RelayRequestEvents>(
    event: K,
    handler: (payload: RelayRequestEvents[K]) => void
  ): () => void {
    const off = this.on(event, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  off<K extends keyof RelayRequestEvents>(
    event: K,
    handler: (payload: RelayRequestEvents[K]) => void
  ): void {
    this.handlers
      .get(event as string)
      ?.delete(handler as (payload: never) => void)
  }

  emit<K extends keyof RelayRequestEvents>(
    event: K,
    payload: RelayRequestEvents[K]
  ): void {
    this.handlers.get(event as string)?.forEach((handler) => {
      try {
        handler(payload as never)
      } catch (e) {
        // A faulty subscriber must not break the relay pipeline
        console.error("[relay] event handler error", e)
      }
    })
  }
}

/**
 * Registers the streaming callback for `plugin:relay|execute` and returns
 * the channel marker `invoke` hands to the Rust side.
 *
 * The SDK's own `Channel` cannot be used here: the pinned
 * `@tauri-apps/api` (2.1.1) reads the message sequence off `{ id }`, while
 * the Rust side we build against (tauri 2.10) sends it as `{ index }` —
 * every message would be buffered under an `undefined` key and never
 * delivered, which silently kills the whole streaming side-channel.
 *
 * A JS-created channel is just the `__CHANNEL__:<callback id>` marker
 * string, so register the callback ourselves against the protocol the
 * current Rust release actually speaks. Messages are re-ordered by their
 * index before delivery: larger payloads go through a fetch round trip
 * that may resolve out of order.
 */
function createStreamEventChannel(
  onEvent: (event: WireStreamEvent) => void
): string {
  let nextIndex = 0
  const pending = new Map<number, WireStreamEvent>()

  const callbackId = transformCallback(
    (raw: { message?: WireStreamEvent; index?: number }) => {
      // The Rust side also emits `{ end: true, index }` when the channel
      // is dropped; those carry no message.
      if (!raw?.message || typeof raw.index !== "number") return

      const deliver = (index: number, message: WireStreamEvent) => {
        onEvent(message)
        nextIndex = index + 1
      }

      if (raw.index < nextIndex) return

      if (raw.index === nextIndex) {
        deliver(raw.index, raw.message)

        while (pending.has(nextIndex)) {
          const queued = pending.get(nextIndex) as WireStreamEvent
          pending.delete(nextIndex)
          deliver(nextIndex, queued)
        }
      } else {
        pending.set(raw.index, raw.message)
      }
    }
  )

  return `__CHANNEL__:${callbackId}`
}

export const implementation: VersionedAPI<RelayV1> = {
  version: { major: 1, minor: 0, patch: 0 },
  api: {
    id: "desktop",
    capabilities: {
      method: new Set([
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "HEAD",
        "OPTIONS",
      ]),
      header: new Set(["stringvalue", "arrayvalue", "multivalue"]),
      content: new Set([
        "text",
        "json",
        "xml",
        "form",
        "binary",
        "multipart",
        "urlencoded",
        "stream",
        "compression",
      ]),
      auth: new Set(["basic", "bearer", "digest", "oauth2", "apikey"]),
      security: new Set([
        "clientcertificates",
        "cacertificates",
        "certificatevalidation",
        "hostverification",
        "peerverification",
      ]),
      proxy: new Set(["http", "https", "authentication", "certificates"]),
      advanced: new Set([
        "retry",
        "redirects",
        "timeout",
        "cookies",
        "keepalive",
        "tcpoptions",
        "http2",
        "http3",
      ]),
    },

    canHandle(request: RelayRequest) {
      if (!this.capabilities.method.has(request.method)) {
        return E.left({
          kind: "unsupported_feature",
          feature: "method",
          message: `Method ${request.method} is not supported`,
          relay: "desktop",
        })
      }

      if (
        request.content &&
        !this.capabilities.content.has(request.content.kind)
      ) {
        return E.left({
          kind: "unsupported_feature",
          feature: "content",
          message: `Content type ${request.content.kind} is not supported`,
          relay: "desktop",
        })
      }

      if (request.auth && !this.capabilities.auth.has(request.auth.kind)) {
        return E.left({
          kind: "unsupported_feature",
          feature: "authentication",
          message: `Authentication type ${request.auth.kind} is not supported`,
          relay: "desktop",
        })
      }

      if (
        request.security?.certificates &&
        !this.capabilities.security.has("clientcertificates")
      ) {
        return E.left({
          kind: "unsupported_feature",
          feature: "security",
          message: "Client certificates are not supported",
          relay: "desktop",
        })
      }

      if (
        request.proxy &&
        !this.capabilities.proxy.has(
          request.proxy.url.startsWith("https") ? "https" : "http"
        )
      ) {
        return E.left({
          kind: "unsupported_feature",
          feature: "proxy",
          message: `Proxy protocol ${request.proxy.url.split(":")[0]} is not supported`,
          relay: "desktop",
        })
      }

      return E.right(true)
    },

    execute(request: RelayRequest) {
      const emitter = new RelayEventHub()

      // Streaming side-channel: the plugin pushes response headers and
      // body chunks here while the request is still in flight, so
      // callers can render progress (SSE timelines) before completion.
      const onEvent = createStreamEventChannel((event) => {
        if (event.type === "headers") {
          emitter.emit("headersReceived", {
            requestId: event.requestId,
            status: event.status,
            statusText: event.statusText,
            headers: event.headers,
          })
        } else if (event.type === "chunk") {
          emitter.emit("chunk", {
            requestId: event.requestId,
            data: event.data,
          })
        }
      })

      const responsePromise = relayRequestToNativeAdapter(request)
        .then((request) => {
          // SAFETY: Type assertion is safe because:
          // 1. The capabilities system prevents requests with unsupported methods from reaching this point
          // 2. Content types not supported by the plugin are filtered by capabilities
          // 3. Authentication methods are validated through capabilities
          // 4. The plugin's Request type is a subset of our Request type
          const pluginRequest = {
            id: request.id,
            url: request.url,
            method: request.method,
            version: request.version,
            headers: request.headers,
            params: request.params,
            content: request.content,
            auth: request.auth,
            security: request.security,
            proxy: request.proxy,
            meta: request.meta,
          }

          return invoke<WireRequestResult>("plugin:relay|execute", {
            request: pluginRequest,
            onEvent,
          })
        })
        .then(
          (result: WireRequestResult): E.Either<RelayError, RelayResponse> => {
            if (result.kind === "success") {
              const response: RelayResponse = {
                id: result.response.id,
                status: result.response.status,
                statusText: result.response.statusText,
                version: result.response.version,
                headers: result.response.headers,
                cookies: result.response.cookies as RelayResponse["cookies"],
                body: body.body(
                  result.response.body.body,
                  result.response.body.mediaType
                ),
                meta: {
                  timing: {
                    start: result.response.meta.timing.start,
                    end: result.response.meta.timing.end,
                  },
                  size: result.response.meta.size,
                },
              }
              return E.right(response)
            }
            return E.left(result.error)
          }
        )
        .catch((error: unknown): E.Either<RelayError, RelayResponse> => {
          const networkError: RelayError = {
            kind: "network",
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
            cause: error,
          }
          return E.left(networkError)
        })

      return {
        cancel: async () => {
          await invoke("plugin:relay|cancel", { requestId: request.id })
        },
        emitter,
        response: responsePromise,
      }
    },
  },
}
