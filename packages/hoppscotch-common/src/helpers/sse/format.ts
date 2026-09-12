import { SSEEvent } from "./parser"

/**
 * Message-format presets for assembling streamed LLM deltas into a
 * complete message, mirroring Apifox's "自动合并" view. Each preset
 * knows where the assistant text (and optional reasoning) lives inside
 * each chunk's JSON payload.
 */
export type MessageFormatPreset =
  | "openai"
  | "gemini"
  | "claude"
  | "ollama-generate"
  | "ollama-chat"
  | "custom"

export const MESSAGE_FORMAT_PRESETS: MessageFormatPreset[] = [
  "openai",
  "gemini",
  "claude",
  "ollama-generate",
  "ollama-chat",
  "custom",
]

export type CustomFormatPaths = {
  /** path to the streamed content text, e.g. `choices.0.delta.content` */
  content?: string
  /** optional path to streamed reasoning/thinking text */
  reasoning?: string
}

export type ExtractedDelta = {
  content: string
  reasoning: string
}

export type AssembledMessage = {
  content: string
  reasoning: string
  /** number of events that contributed a non-empty text */
  chunkCount: number
}

/**
 * Resolve a tolerant dot-path against a parsed JSON value. Supports
 * `a.b.0.c`, bracketed `a.b[0].c` and an optional leading `$.`. Returns
 * `undefined` for any miss so callers can skip non-matching chunks.
 */
export function resolveJsonPath(value: unknown, path: string): unknown {
  if (!path) return undefined

  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")

  if (!normalized) return undefined

  let current: unknown = value
  for (const segment of normalized.split(".")) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx)) return undefined
      current = current[idx]
      continue
    }
    if (typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : ""

/**
 * Extract the streamed text delta from a single event's `data` payload
 * according to the selected preset. Events whose data is not JSON, or
 * that match no field of the preset, yield an empty delta and are
 * skipped during assembly.
 */
export function extractDelta(
  event: SSEEvent,
  preset: MessageFormatPreset,
  custom: CustomFormatPaths = {}
): ExtractedDelta {
  if (event.isTerminal || !event.data) return { content: "", reasoning: "" }

  let payload: unknown
  try {
    payload = JSON.parse(event.data)
  } catch (_e) {
    return { content: "", reasoning: "" }
  }

  if (payload === null || typeof payload !== "object") {
    return { content: "", reasoning: "" }
  }

  switch (preset) {
    case "openai": {
      // chat.completions chunks. Covers DeepSeek R1's
      // `reasoning_content` and Qwen/OpenRouter-style `reasoning`.
      const delta = resolveJsonPath(payload, "choices.0.delta") as
        | Record<string, unknown>
        | undefined
      if (!delta) return { content: "", reasoning: "" }
      return {
        content: asText(delta.content),
        reasoning:
          asText(delta.reasoning_content) || asText(delta.reasoning),
      }
    }

    case "gemini": {
      // streamGenerateContent chunks; reasoning parts carry
      // `thought: true` alongside their text.
      const parts = resolveJsonPath(
        payload,
        "candidates.0.content.parts"
      ) as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(parts)) return { content: "", reasoning: "" }

      let content = ""
      let reasoning = ""
      for (const part of parts) {
        if (!part || typeof part !== "object") continue
        const text = asText(part.text)
        if (part.thought === true) reasoning += text
        else content += text
      }
      return { content, reasoning }
    }

    case "claude": {
      // messages stream: content_block_delta events carry
      // `delta.text` (text_delta) or `delta.thinking` (thinking_delta).
      const delta = resolveJsonPath(payload, "delta") as
        | Record<string, unknown>
        | undefined
      if (!delta) return { content: "", reasoning: "" }
      return {
        content: asText(delta.text),
        reasoning: asText(delta.thinking),
      }
    }

    case "ollama-generate":
      return {
        content: asText(resolveJsonPath(payload, "response")),
        reasoning: asText(resolveJsonPath(payload, "thinking")),
      }

    case "ollama-chat": {
      const message = resolveJsonPath(payload, "message") as
        | Record<string, unknown>
        | undefined
      if (!message) return { content: "", reasoning: "" }
      return {
        content: asText(message.content),
        reasoning: asText(message.thinking),
      }
    }

    case "custom": {
      const { content, reasoning } = custom
      return {
        content: content ? asText(resolveJsonPath(payload, content)) : "",
        reasoning: reasoning
          ? asText(resolveJsonPath(payload, reasoning))
          : "",
      }
    }
  }
}

/**
 * Assemble streamed events into a complete message by concatenating the
 * per-event deltas in stream order. Terminal markers, comment/keep-alive
 * events and non-matching payloads are skipped.
 */
export function assembleMessages(
  events: SSEEvent[],
  preset: MessageFormatPreset,
  custom: CustomFormatPaths = {}
): AssembledMessage {
  let content = ""
  let reasoning = ""
  let chunkCount = 0

  for (const event of events) {
    const delta = extractDelta(event, preset, custom)
    if (delta.content || delta.reasoning) {
      content += delta.content
      reasoning += delta.reasoning
      chunkCount++
    }
  }

  return { content, reasoning, chunkCount }
}
