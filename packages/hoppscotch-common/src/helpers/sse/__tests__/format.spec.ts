import { describe, expect, it } from "vitest"
import { parseSSEStream } from "../parser"
import {
  assembleMessages,
  extractDelta,
  resolveJsonPath,
} from "../format"

describe("resolveJsonPath", () => {
  const value = { a: { b: [{ c: 1 }, { c: 2 }] }, top: "x" }

  it("resolves dot paths with numeric indices", () => {
    expect(resolveJsonPath(value, "a.b.1.c")).toBe(2)
    expect(resolveJsonPath(value, "top")).toBe("x")
  })

  it("supports bracket notation and a leading $", () => {
    expect(resolveJsonPath(value, "$.a.b[0].c")).toBe(1)
  })

  it("returns undefined on misses and empty paths", () => {
    expect(resolveJsonPath(value, "a.b.9.c")).toBeUndefined()
    expect(resolveJsonPath(value, "")).toBeUndefined()
    expect(resolveJsonPath(null, "a")).toBeUndefined()
  })
})

const openaiChunk = (delta: Record<string, unknown>) =>
  JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta }],
  })

describe("extractDelta", () => {
  it("extracts openai content and reasoning_content", () => {
    const events = parseSSEStream(
      `data: ${openaiChunk({ content: "He" })}\n\ndata: ${openaiChunk({
        reasoning_content: "thinking",
      })}\n\ndata: [DONE]\n\n`
    )
    expect(extractDelta(events[0], "openai")).toEqual({
      content: "He",
      reasoning: "",
    })
    expect(extractDelta(events[1], "openai")).toEqual({
      content: "",
      reasoning: "thinking",
    })
    // [DONE] yields nothing
    expect(extractDelta(events[2], "openai")).toEqual({
      content: "",
      reasoning: "",
    })
  })

  it("falls back to the qwen-style reasoning field", () => {
    const events = parseSSEStream(
      `data: ${openaiChunk({ reasoning: "q" })}\n\n`
    )
    expect(extractDelta(events[0], "openai").reasoning).toBe("q")
  })

  it("extracts gemini parts, separating thought parts", () => {
    const chunk = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "thought ", thought: true },
              { text: "answer" },
            ],
          },
        },
      ],
    })
    const events = parseSSEStream(`data: ${chunk}\n\n`)
    expect(extractDelta(events[0], "gemini")).toEqual({
      content: "answer",
      reasoning: "thought ",
    })
  })

  it("extracts claude text_delta and thinking_delta", () => {
    const textChunk = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hi" },
    })
    const thinkChunk = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "hmm" },
    })
    const events = parseSSEStream(
      `event: content_block_delta\ndata: ${textChunk}\n\n` +
        `event: content_block_delta\ndata: ${thinkChunk}\n\n`
    )
    expect(extractDelta(events[0], "claude")).toEqual({
      content: "hi",
      reasoning: "",
    })
    expect(extractDelta(events[1], "claude")).toEqual({
      content: "",
      reasoning: "hmm",
    })
  })

  it("extracts ollama generate and chat fields", () => {
    const gen = parseSSEStream('data: {"response":"hi"}\n\n')
    expect(extractDelta(gen[0], "ollama-generate").content).toBe("hi")

    const chat = parseSSEStream(
      'data: {"message":{"content":"yo"}}\n\n'
    )
    expect(extractDelta(chat[0], "ollama-chat").content).toBe("yo")
  })

  it("extracts custom paths", () => {
    const events = parseSSEStream(
      `data: ${openaiChunk({ content: "c" })}\n\n`
    )
    expect(
      extractDelta(events[0], "custom", {
        content: "choices.0.delta.content",
      })
    ).toEqual({ content: "c", reasoning: "" })
  })

  it("skips non-JSON and non-matching payloads", () => {
    const events = parseSSEStream("data: plain\n\ndata: {\"other\":1}\n\n")
    expect(extractDelta(events[0], "openai")).toEqual({
      content: "",
      reasoning: "",
    })
    expect(extractDelta(events[1], "openai")).toEqual({
      content: "",
      reasoning: "",
    })
  })
})

describe("assembleMessages", () => {
  it("concatenates deltas in stream order and counts chunks", () => {
    const stream =
      `data: ${openaiChunk({ reasoning_content: "think " })}\n\n` +
      `data: ${openaiChunk({ reasoning_content: "hard" })}\n\n` +
      `data: ${openaiChunk({ content: "He" })}\n\n` +
      `data: ${openaiChunk({ content: "llo" })}\n\n` +
      "data: [DONE]\n\n"

    const events = parseSSEStream(stream)
    const assembled = assembleMessages(events, "openai")

    expect(assembled).toEqual({
      content: "Hello",
      reasoning: "think hard",
      chunkCount: 4,
    })
  })

  it("returns an empty message for non-LLM streams", () => {
    const events = parseSSEStream("data: hello\n\ndata: world\n\n")
    expect(assembleMessages(events, "openai")).toEqual({
      content: "",
      reasoning: "",
      chunkCount: 0,
    })
  })
})
