import { markRaw } from "vue"
import * as E from "fp-ts/Either"
import { pipe } from "fp-ts/function"
import { getI18n } from "~/modules/i18n"
import {
  postProcessRelayRequest,
  preProcessRelayRequest,
} from "~/helpers/functional/process-request"
import {
  relayRequestToNativeAdapter,
  type RelayCapabilities,
  type RelayEventEmitter,
  type RelayRequest,
  type RelayRequestEvents,
  type RelayResponse,
} from "@hoppscotch/kernel"
import { Relay } from "~/kernel/relay"
import { Service } from "dioc"
import type {
  KernelInterceptor,
  ExecutionResult,
  KernelInterceptorError,
} from "~/services/kernel-interceptor.service"
import { CookieJarService } from "~/services/cookie-jar.service"
import InterceptorsErrorPlaceholder from "~/components/settings/InterceptorErrorPlaceholder.vue"
import SettingsNative from "~/components/settings/Native.vue"
import { KernelInterceptorNativeStore } from "./store"

/**
 * Event hub backing `ExecutionResult.emitter`.
 *
 * It has to exist synchronously: subscribers (`helpers/network.ts`)
 * attach right after `execute()` returns, while the relay execution
 * that actually produces the streaming events is only created further
 * down the async request pipeline, once it reaches `Relay.execute`.
 * Relay events are forwarded into this hub.
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

export class NativeKernelInterceptorService
  extends Service
  implements KernelInterceptor
{
  public static readonly ID = "NATIVE_KERNEL_INTERCEPTOR_SERVICE"

  private readonly store = this.bind(KernelInterceptorNativeStore)
  private readonly cookieJar = this.bind(CookieJarService)

  public readonly id = "native"
  public readonly name = (t: ReturnType<typeof getI18n>) =>
    t("interceptor.native.name")
  public readonly selectable = { type: "selectable" as const }
  public readonly capabilities: RelayCapabilities = {
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
      "compression",
    ]),
    auth: new Set(["basic", "bearer", "apikey", "digest", "aws", "hawk"]),
    security: new Set([
      "clientcertificates",
      "cacertificates",
      "certificatevalidation",
      "hostverification",
      "peerverification",
    ]),
    proxy: new Set(["http", "https", "authentication", "certificates"]),
    advanced: new Set(["redirects", "cookies", "localaccess"]),
  } as const
  public readonly settingsEntry = markRaw({
    title: (t: ReturnType<typeof getI18n>) =>
      t("interceptor.native.settings_title"),
    component: SettingsNative,
  })

  public execute(
    request: RelayRequest
  ): ExecutionResult<KernelInterceptorError> {
    const emitter = new RelayEventHub()

    let relayExecution: {
      cancel: () => Promise<void>
      emitter?: ExecutionResult["emitter"]
    } | null = null

    // The relay execution only exists once the async `executeRequest`
    // pipeline reaches `Relay.execute`. Forward its streaming events
    // (`headersReceived` / `chunk`) into the eager hub above so
    // subscribers attached at `execute()` time never miss the stream.
    const bindRelayExecution = (execution: {
      cancel: () => Promise<void>
      emitter?: ExecutionResult["emitter"]
    }) => {
      relayExecution = execution

      execution.emitter?.on("headersReceived", (event) => {
        emitter.emit("headersReceived", event)
      })
      execution.emitter?.on("chunk", (event) => {
        emitter.emit("chunk", event)
      })
    }

    return {
      cancel: async () => {
        if (relayExecution) {
          await relayExecution.cancel()
        }
      },
      emitter,
      response: pipe(
        this.executeRequest(request, bindRelayExecution),
        (promise) =>
          promise.then((either) =>
            pipe(
              either,
              E.mapLeft((error): KernelInterceptorError => {
                const humanMessage = {
                  heading: (t: ReturnType<typeof getI18n>) => {
                    switch (error.kind) {
                      case "network":
                        return t("error.network.heading")
                      case "timeout":
                        return t("error.timeout.heading")
                      case "certificate":
                        return t("error.certificate.heading")
                      case "auth":
                        return t("error.auth.heading")
                      case "proxy":
                        return t("error.proxy.heading")
                      case "parse":
                        return t("error.parse.heading")
                      case "version":
                        return t("error.version.heading")
                      case "abort":
                        return t("error.aborted.heading")
                      default:
                        return t("error.unknown.heading")
                    }
                  },
                  description: (t: ReturnType<typeof getI18n>) => {
                    switch (error.kind) {
                      case "network":
                        return t("error.network.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "timeout":
                        return t("error.timeout.description", {
                          message: error.message,
                          phase: error.phase ?? t("error.unknown.phase"),
                        })
                      case "certificate":
                        return t("error.certificate.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "auth":
                        return t("error.auth.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "proxy":
                        return t("error.proxy.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "parse":
                        return t("error.parse.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "version":
                        return t("error.version.description", {
                          message: error.message,
                          cause: error.cause ?? t("error.unknown.cause"),
                        })
                      case "abort":
                        return t("error.aborted.description", {
                          message: error.message,
                        })
                      default:
                        return t("error.unknown.description")
                    }
                  },
                }
                return {
                  humanMessage,
                  error,
                  component: InterceptorsErrorPlaceholder,
                }
              })
            )
          )
      ),
    }
  }

  private async executeRequest(
    request: RelayRequest,
    setRelayExecution: (execution: {
      cancel: () => Promise<void>
      emitter?: ExecutionResult["emitter"]
    }) => void
  ): Promise<E.Either<any, RelayResponse>> {
    try {
      const effectiveRequest = this.store.completeRequest(
        preProcessRelayRequest(request)
      )

      // A caller opts a request out of the shared cookie jar by setting
      // `meta.options.cookies` to false. The desktop auth module sets it
      // on its own bearer-authenticated backend calls so the interceptor
      // skips both attaching a captured auth cookie to them and capturing
      // one from their responses. Without that, a stale or blank
      // `access_token` cookie was read in preference to the bearer token
      // and desktop login stalled. Read from the original request because
      // `completeRequest` rebuilds `meta` from domain settings.
      const useCookieJar = request.meta?.options?.cookies !== false

      if (useCookieJar) {
        await this.cookieJar.applyCookiesToRequest(effectiveRequest)
      }

      const existingUserAgentHeader = Object.keys(
        effectiveRequest.headers || {}
      ).find((header) => header.toLowerCase() === "user-agent")

      // A temporary workaround to add a User-Agent header to the request
      // This will be removed once the kernel/relay is updated to add User-Agent header by default
      const effectiveRequestWithUserAgent = {
        ...effectiveRequest,
        headers: {
          ...effectiveRequest.headers,
          "User-Agent": existingUserAgentHeader
            ? effectiveRequest.headers[existingUserAgentHeader]
            : "HoppscotchKernel/0.2.0",
        },
      }

      const nativeRequest = await relayRequestToNativeAdapter(
        effectiveRequestWithUserAgent
      )
      const postProcessedRequest = postProcessRelayRequest(nativeRequest)
      const relayExecution = Relay.execute(postProcessedRequest)

      setRelayExecution(relayExecution)

      const relayResponse = await relayExecution.response
      if (E.isRight(relayResponse) && useCookieJar) {
        await this.cookieJar.captureResponseCookies(
          relayResponse.right,
          effectiveRequest.url
        )
      }
      return relayResponse
    } catch (e) {
      return E.left(e)
    }
  }
}
