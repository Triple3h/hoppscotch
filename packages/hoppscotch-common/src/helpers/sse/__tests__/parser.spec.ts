import { describe, expect, it } from "vitest"
import {
  SSEStreamParser,
  parseSSEStream,
  looksLikeSSE,
} from "../parser"

describe("SSEStreamParser", () => {
  it("parses a basic data event", () => {
    const events = parseSSEStream('data: {"a":1}\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      index: 0,
      event: "message",
      data: '{"a":1}',
      isTerminal: false,
    })
  })

  it("defaults the event name to message and resets it after dispatch", () => {
    const events = parseSSEStream(
      "event: ping\ndata: 1\n\ndata: 2\n\n"
    )
    expect(events[0].event).toBe("ping")
    expect(events[1].event).toBe("message")
    expect(events[1].index).toBe(1)
  })

  it("joins multi-line data with newlines", () => {
    const events = parseSSEStream("data: line1\ndata:line2\n\n")
    expect(events[0].data).toBe("line1\nline2")
  })

  it("ignores comment lines (keep-alive pings)", () => {
    const events = parseSSEStream(": ping\n\n: longer comment\ndata: x\n\n")
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("x")
  })

  it("handles CRLF line endings", () => {
    const events = parseSSEStream("data: a\r\ndata: b\r\n\r\n")
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("a\nb")
  })

  it("recognizes the [DONE] terminal marker", () => {
    const events = parseSSEStream('data: {"x":1}\n\ndata: [DONE]\n\n')
    expect(events[0].isTerminal).toBe(false)
    expect(events[1].isTerminal).toBe(true)
  })

  it("carries the id field across events until changed", () => {
    const events = parseSSEStream("id: 41\ndata: a\n\ndata: b\n\nid: 42\ndata: c\n\n")
    expect(events[0].id).toBe("41")
    expect(events[1].id).toBe("41")
    expect(events[2].id).toBe("42")
  })

  it("ignores ids containing NULL, per spec", () => {
    const events = parseSSEStream("id: a\u0000b\ndata: x\n\n")
    expect(events[0].id).toBeNull()
  })

  it("ignores unknown fields", () => {
    const events = parseSSEStream("unknown: value\ndata: x\n\n")
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("x")
  })

  it("parses data lines without a space after the colon", () => {
    const events = parseSSEStream("data:x\n\n")
    expect(events[0].data).toBe("x")
  })

  it("does not dispatch a blank stream", () => {
    expect(parseSSEStream("\n\n\n")).toHaveLength(0)
    expect(parseSSEStream(": only comments\n\n")).toHaveLength(0)
  })

  it("stamps receivedAt on dispatched events", () => {
    const parser = new SSEStreamParser()
    const events = parser.feed("data: a\n\n", 1726100000000)
    expect(events[0].time).toBe(1726100000000)
  })

  it("reassembles events split across incremental chunks", () => {
    const stream =
      'data: {"delta":"Hel' +
      'lo"}\n\n' +
      "event: done\ndata: [DONE]\n\n"

    const parser = new SSEStreamParser()
    const all = []

    // Feed in awkward 7-byte slices to force cross-chunk splits everywhere
    for (let i = 0; i < stream.length; i += 7) {
      all.push(...parser.feed(stream.slice(i, i + 7)))
    }

    expect(all).toHaveLength(2)
    expect(all[0].data).toBe('{"delta":"Hello"}')
    expect(all[1].event).toBe("done")
    expect(all[1].isTerminal).toBe(true)
  })

  it("flush recovers a final event missing its blank line", () => {
    const parser = new SSEStreamParser()
    const events = [
      ...parser.feed('data: {"delta":"Hi"}\n\n'),
      ...parser.feed("data: [DONE]"),
      ...parser.flush(),
    ]
    expect(events).toHaveLength(2)
    expect(events[1].isTerminal).toBe(true)
  })

  it("flush recovers a final partial line without any line ending", () => {
    const parser = new SSEStreamParser()
    const events = [...parser.feed("data: partial-no-newline"), ...parser.flush()]
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("partial-no-newline")
  })
})

describe("looksLikeSSE", () => {
  it("detects SSE payloads", () => {
    expect(looksLikeSSE('data: {"a":1}\n\n')).toBe(true)
    expect(looksLikeSSE("event: message\ndata: x\n\n")).toBe(true)

    const bytes = new TextEncoder().encode("data: x\n\n")
    const ab = new ArrayBuffer(bytes.length)
    new Uint8Array(ab).set(bytes)
    expect(looksLikeSSE(ab)).toBe(true)
  })

  it("rejects ordinary text and JSON", () => {
    expect(looksLikeSSE('{"data": "not sse"}')).toBe(false)
    expect(looksLikeSSE("plain text body")).toBe(false)
    expect(looksLikeSSE("")).toBe(false)
  })

  it("rejects SSE-looking fields that are not at line starts", () => {
    // 'data:' only appears mid-JSON-string, not at a line start
    expect(looksLikeSSE('{"a":"data: nope"}')).toBe(false)
  })
})
