import { describe, expect, it } from "vitest"
import { getSuitableLenses } from "../lenses"
import sseLens from "../sseLens"
import type { HoppRESTResponse } from "../../types/HoppRESTResponse"

function loadingWith(
  streaming?: {
    headers: { key: string; value: string }[]
    statusCode: number
    statusText: string
    body: ArrayBuffer
    receivedBytes: number
  } | null
): HoppRESTResponse {
  const base = { type: "loading" as const, req: {} as never }
  if (!streaming) return base
  return { ...base, streaming }
}

describe("getSuitableLenses while streaming", () => {
  it("keeps the events lens when content-type is not in the header set yet", () => {
    const lenses = getSuitableLenses(
      loadingWith({
        headers: [],
        statusCode: 200,
        statusText: "OK",
        body: new ArrayBuffer(0),
        receivedBytes: 0,
      })
    )
    expect(lenses).toEqual([sseLens])
  })

  it("keeps the events lens for text/event-stream content-type", () => {
    const lenses = getSuitableLenses(
      loadingWith({
        headers: [
          { key: "Content-Type", value: "text/event-stream; charset=utf-8" },
        ],
        statusCode: 200,
        statusText: "OK",
        body: new ArrayBuffer(0),
        receivedBytes: 0,
      })
    )
    expect(lenses).toEqual([sseLens])
  })

  it("returns no lenses for non-SSE content-type while loading", () => {
    const lenses = getSuitableLenses(
      loadingWith({
        headers: [{ key: "content-type", value: "application/json" }],
        statusCode: 200,
        statusText: "OK",
        body: new ArrayBuffer(0),
        receivedBytes: 0,
      })
    )
    expect(lenses).toEqual([])
  })

  it("returns no lenses when the response has not started streaming yet", () => {
    expect(getSuitableLenses(loadingWith(null))).toEqual([])
    expect(getSuitableLenses({ type: "loading", req: {} as never })).toEqual([])
  })
})
