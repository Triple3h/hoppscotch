import * as TE from "fp-ts/TaskEither"
import { BehaviorSubject, Observable } from "rxjs"
import { cloneDeep } from "lodash-es"
import { HoppRESTResponse, HoppRESTResponseHeader } from "./types/HoppRESTResponse"
import { EffectiveHoppRESTRequest } from "./utils/EffectiveURL"
import { getService } from "~/modules/dioc"
import {
  ExecutionResult,
  KernelInterceptorService,
} from "~/services/kernel-interceptor.service"
import { RESTRequest, RESTResponse } from "~/helpers/kernel/rest"
import { RelayError } from "@hoppscotch/kernel"

export type NetworkStrategy = (
  req: EffectiveHoppRESTRequest
) => TE.TaskEither<RelayError, HoppRESTResponse>

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Surface relay streaming events (response headers + incremental body
 * chunks, emitted while the request is still in flight) as
 * `loading + streaming` states on the response subject, so the SSE
 * timeline can render progress in real time. Emission is throttled —
 * chunks can arrive in rapid bursts and each emission re-copies the
 * accumulated body.
 */
function attachStreamingRelayEvents(
  result: ExecutionResult,
  response: BehaviorSubject<HoppRESTResponse>,
  req: EffectiveHoppRESTRequest
): void {
  const emitter = result.emitter
  if (!emitter) return

  const streamChunks: Uint8Array[] = []
  let receivedBytes = 0
  let streamHeaders: {
    headers: HoppRESTResponseHeader[]
    statusCode: number
    statusText: string
  } | null = null

  const STREAM_EMIT_INTERVAL_MS = 50
  let lastEmit = 0
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  const emitStreamingState = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < STREAM_EMIT_INTERVAL_MS) {
      if (!pendingTimer) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null
          emitStreamingState(true)
        }, STREAM_EMIT_INTERVAL_MS - (now - lastEmit))
      }
      return
    }

    lastEmit = now

    const merged = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of streamChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    response.next({
      type: "loading",
      req,
      streaming: {
        headers: streamHeaders?.headers ?? [],
        statusCode: streamHeaders?.statusCode ?? 0,
        statusText: streamHeaders?.statusText ?? "",
        body: merged.buffer as ArrayBuffer,
        receivedBytes,
      },
    })
  }

  emitter.on("headersReceived", (event) => {
    streamHeaders = {
      headers: Object.entries(event.headers ?? {}).map(([key, value]) => ({
        key,
        value,
      })),
      statusCode: event.status,
      statusText: event.statusText ?? "",
    }
    emitStreamingState(true)
  })

  emitter.on("chunk", (event) => {
    const bytes = decodeBase64(event.data)
    if (bytes.length === 0) return
    streamChunks.push(bytes)
    receivedBytes += bytes.length
    emitStreamingState()
  })
}

export function createRESTNetworkRequestStream(
  request: EffectiveHoppRESTRequest,
  streamOptions?: {
    // Opts the request out of the shared cookie jar at the interceptor
    // level (`meta.options.cookies: false`) — isolated embed runs must not
    // ride the viewer's cookies even on cookie-enabled platforms (desktop)
    noCookieJar?: boolean
  }
): [Observable<HoppRESTResponse>, () => void] {
  const response = new BehaviorSubject<HoppRESTResponse>({
    type: "loading",
    req: request,
  })

  const req = cloneDeep(request)

  const execResult = RESTRequest.toRequest(req).then((kernelRequest) => {
    if (kernelRequest && streamOptions?.noCookieJar) {
      kernelRequest.meta = {
        ...kernelRequest.meta,
        options: { ...kernelRequest.meta?.options, cookies: false },
      }
    }
    if (!kernelRequest) {
      response.next({
        type: "network_fail",
        req,
        error: new Error("Failed to create kernel request"),
      })
      response.complete()
      return
    }

    return service.execute(kernelRequest)
  })

  const service = getService(KernelInterceptorService)

  execResult.then((result) => {
    if (!result) return

    attachStreamingRelayEvents(result, response, req)

    result.response.then(async (res) => {
      if (res._tag === "Right") {
        const processedRes = await RESTResponse.toResponse(res.right, req)

        if (processedRes.type === "success") {
          response.next(processedRes)
        } else {
          response.next({
            type: "network_fail",
            req,
            error: processedRes.error,
          })
        }
      } else {
        response.next({
          type: "interceptor_error",
          req,
          error: res.left,
        })
      }
      response.complete()
    })
  })

  return [
    response,
    async () => {
      try {
        const result = await execResult
        if (result) await result.cancel()
      } catch (_error) {
        // Ignore cancel errors - request may have already completed
        // This is expected behavior and not an actual error
      }
    },
  ]
}
