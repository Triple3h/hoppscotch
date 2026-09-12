/**
 * Server-Sent Events parsing per the W3C `text/event-stream` spec:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * Two consumption modes:
 * - Incremental: `SSEStreamParser.feed()` as network chunks arrive, so
 *   events can be dispatched in real time while the response streams.
 * - Post-hoc: `parseSSEStream()` on a complete body, for responses that
 *   finished before (or without) streaming UI.
 *
 * The OpenAI-style `data: [DONE]` terminal marker is recognized via the
 * `isTerminal` flag (it is not part of the W3C spec).
 */

export type SSEEvent = {
  /** 0-based position of the dispatched event in the stream */
  index: number
  /** `event:` field value; defaults to `"message"` */
  event: string
  /** last `id:` field value seen before this event, if any */
  id: string | null
  /** `data:` lines joined with `\n` */
  data: string
  /** true when the data equals the OpenAI-style `[DONE]` terminal marker */
  isTerminal: boolean
  /** client-side reception timestamp (ms); absent for post-hoc parsing */
  time?: number
}

export const SSE_TERMINAL_MARKER = "[DONE]"

const isLineEnd = (ch: string) => ch === "\n" || ch === "\r"

/** Index of the next CR/LF from `start`, or -1 when none remains */
const findLineEnd = (buf: string, start: number): number => {
  for (let i = start; i < buf.length; i++) {
    if (isLineEnd(buf[i])) return i
  }
  return -1
}

/**
 * Length of the line ending at `idx` (CRLF counts as one): 2 for `\r\n`,
 * 1 for a lone `\r` or `\n`, 0 when `idx` is not a line end.
 */
const lineEndLength = (buf: string, idx: number): number => {
  if (buf[idx] === "\r" && buf[idx + 1] === "\n") return 2
  if (isLineEnd(buf[idx])) return 1
  return 0
}

export class SSEStreamParser {
  private buffer = ""
  private eventName = "message"
  private lastEventId: string | null = null
  private dataLines: string[] = []
  private dispatchedCount = 0

  /**
   * Feed a received chunk into the parser. Returns the events completed
   * by this chunk (an event is only dispatched on its terminating blank
   * line, per spec). `receivedAt` is stamped on dispatched events so the
   * UI can show per-event arrival times.
   */
  feed(chunk: string, receivedAt?: number): SSEEvent[] {
    this.buffer += chunk

    const events: SSEEvent[] = []
    let start = 0

    while (start < this.buffer.length) {
      const end = findLineEnd(this.buffer, start)
      if (end === -1) break

      const line = this.buffer.slice(start, end)
      start = end + lineEndLength(this.buffer, end)

      const dispatched = this.processLine(line, receivedAt)
      if (dispatched) events.push(dispatched)
    }

    this.buffer = this.buffer.slice(start)
    return events
  }

  /**
   * Dispatch anything still pending at end-of-stream. The spec discards
   * unfinished events, but real-world LLM streams sometimes close right
   * after the final `data:` line without the terminating blank line —
   * being lenient here recovers that last event instead of dropping it.
   */
  flush(receivedAt?: number): SSEEvent[] {
    const events: SSEEvent[] = []

    // Process whatever partial line remains in the buffer
    if (this.buffer.length > 0) {
      const line = this.buffer
      this.buffer = ""
      const dispatched = this.processLine(line, receivedAt)
      if (dispatched) events.push(dispatched)
    }

    const pending = this.dispatch(receivedAt)
    if (pending) events.push(pending)

    return events
  }

  private processLine(line: string, receivedAt?: number): SSEEvent | null {
    // Blank line dispatches the event collected so far
    if (line === "") return this.dispatch(receivedAt)

    // Lines starting with a colon are comments (keep-alive pings etc.)
    if (line.startsWith(":")) return null

    let field: string
    let value: string
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) {
      field = line
      value = ""
    } else {
      field = line.slice(0, colonIdx)
      value = line.slice(colonIdx + 1)
      // A single optional space after the colon is stripped, per spec
      if (value.startsWith(" ")) value = value.slice(1)
    }

    switch (field) {
      case "event":
        if (value !== "") this.eventName = value
        break
      case "data":
        this.dataLines.push(value)
        break
      case "id":
        // Spec: an id containing NULL is ignored
        if (!value.includes("\u0000")) this.lastEventId = value
        break
      case "retry": {
        // Non-numeric retry values are ignored, per spec
        const ms = Number(value)
        if (value !== "" && Number.isFinite(ms) && ms >= 0) {
          // Parsed for completeness; reconnection is not driven here
        }
        break
      }
      // Unknown fields are ignored, per spec
    }

    return null
  }

  private dispatch(receivedAt?: number): SSEEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = "message"
      return null
    }

    const data = this.dataLines.join("\n")
    this.dataLines = []

    const event: SSEEvent = {
      index: this.dispatchedCount++,
      event: this.eventName,
      id: this.lastEventId,
      data,
      isTerminal: data.trim() === SSE_TERMINAL_MARKER,
    }

    if (receivedAt !== undefined) event.time = receivedAt

    // The event field resets after every dispatch, per spec
    this.eventName = "message"
    return event
  }
}

/** Parse a complete SSE body into its dispatched events */
export function parseSSEStream(text: string): SSEEvent[] {
  const parser = new SSEStreamParser()
  const events = parser.feed(text)
  events.push(...parser.flush())
  return events
}

/**
 * Heuristic body sniff for SSE payloads, used when the Content-Type
 * header is missing or generic (`text/plain` behind some gateways).
 * Deliberately conservative: needs an SSE field at a line start within
 * the first KB, so ordinary JSON/text never trips it.
 */
export function looksLikeSSE(body: string | ArrayBuffer): boolean {
  if (!body) return false

  const text =
    body instanceof ArrayBuffer
      ? new TextDecoder("utf-8", { fatal: false }).decode(
          body.slice(0, 1024)
        )
      : body.slice(0, 1024)

  return /^[ \t]*(data|event|id|retry):/m.test(text)
}
