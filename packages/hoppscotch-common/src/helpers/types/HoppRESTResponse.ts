import { HoppRESTRequest } from "@hoppscotch/data"
import { Component } from "vue"
import { KernelInterceptorError } from "~/services/kernel-interceptor.service"

export type HoppRESTResponseHeader = { key: string; value: string }

export type HoppRESTSuccessResponse = {
  type: "success"
  headers: HoppRESTResponseHeader[]
  body: ArrayBuffer
  statusCode: number
  statusText: string
  meta: {
    responseSize: number // in bytes
    responseDuration: number // in millis
  }
  req: HoppRESTRequest
}

export type HoppRESTFailureResponse = {
  type: "failure"
  headers: HoppRESTResponseHeader[]
  body: ArrayBuffer
  statusCode: number
  statusText: string
  meta: {
    responseSize: number // in bytes
    responseDuration: number // in millis
  }
  req: HoppRESTRequest
}

export type HoppRESTFailureNetwork = {
  type: "network_fail"
  error: unknown
  req: HoppRESTRequest
}

export type HoppRESTFailureScript = {
  type: "script_fail"
  error: Error
}

export type HoppRESTErrorExtension = {
  type: "extension_error"
  error: string
  component: Component
  req: HoppRESTRequest
}

export type HoppRESTErrorInterceptor = {
  type: "interceptor_error"
  error: KernelInterceptorError
  req: HoppRESTRequest
}

export type HoppRESTLoadingResponse = {
  type: "loading"
  req: HoppRESTRequest
  /**
   * Present while the response body is still streaming in (relay chunk
   * events). Carries the accumulated body so far plus whatever response
   * headers/status have already arrived, so the SSE lens can render the
   * timeline live. Absent for plain loading states.
   */
  streaming?: {
    headers: HoppRESTResponseHeader[]
    statusCode: number
    statusText: string
    body: ArrayBuffer
    receivedBytes: number
  }
}

export type HoppRESTResponse =
  | HoppRESTLoadingResponse
  | HoppRESTSuccessResponse
  | HoppRESTFailureResponse
  | HoppRESTFailureNetwork
  | HoppRESTFailureScript
  | HoppRESTFailureExtension
  | HoppRESTFailureInterceptor
