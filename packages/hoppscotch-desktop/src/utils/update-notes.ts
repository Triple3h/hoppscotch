/**
 * Update notes are the `notes` field of the update manifest, rendered inside
 * the launcher window (500x700). They get parsed into blocks with inline spans
 * rather than injected as HTML: the text arrives over the network, and a
 * release note has no business producing live DOM (`v-html`).
 *
 * `.github/scripts/build-update-notes.mjs` writes `### <group>` headings
 * followed by `- <commit subject>` items, but releases made before that
 * script existed carry whole GitHub release notes (download tables, Gatekeeper
 * instructions, a workflow link). Anything that does not match the expected
 * shape degrades to a paragraph instead of breaking the screen.
 */
export type UpdateNoteSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "emphasis"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }

export interface UpdateNoteBlock {
  kind: "heading" | "item" | "text"
  spans: UpdateNoteSpan[]
}

// Ordered alternation: `**strong**` has to be tried before `*emphasis*`,
// otherwise the emphasis branch would eat the first asterisk of a bold marker.
const INLINE_PATTERN =
  /(\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g

// The launcher window has no browser of its own, so only http(s) URLs become
// links: a note should never be able to hand `file:`/`javascript:` to the OS.
const isExternalHref = (href: string): boolean => /^https?:\/\//i.test(href)

/**
 * Splits a single line of markdown into inline spans (bold, italics, code
 * spans, links). Anything unrecognised stays verbatim text, so a stray `*` in
 * a commit subject renders as itself.
 */
export const parseNoteSpans = (text: string): UpdateNoteSpan[] => {
  const spans: UpdateNoteSpan[] = []

  let cursor = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) {
      spans.push({ kind: "text", text: text.slice(cursor, start) })
    }

    const token = match[0]

    if (token.startsWith("[")) {
      // Parentheses are not allowed inside the target: the outer pattern stops
      // at the first `)`, so a target like `javascript:alert(1)` would leave a
      // dangling `)`. Rejecting it keeps the whole construct as literal text,
      // which reads better than half a link.
      const link = /^\[([^\]]*)\]\(([^()]*)\)$/.exec(token)
      const label = link?.[1] ?? token
      const href = link?.[2]?.trim() ?? ""

      spans.push(
        link && isExternalHref(href)
          ? { kind: "link", text: label, href }
          : { kind: "text", text: label }
      )
    } else if (token.startsWith("`")) {
      spans.push({ kind: "code", text: token.replace(/`/g, "") })
    } else if (token.startsWith("**")) {
      spans.push({ kind: "strong", text: token.slice(2, -2) })
    } else {
      spans.push({ kind: "emphasis", text: token.slice(1, -1) })
    }

    cursor = start + token.length
  }

  if (cursor < text.length) {
    spans.push({ kind: "text", text: text.slice(cursor) })
  }

  return spans.length > 0 ? spans : [{ kind: "text", text }]
}

// Lines that only carry release plumbing (workflow links, markdown tables)
// and mean nothing on the update screen.
const isNoise = (text: string): boolean =>
  /^workflow run:/i.test(text) ||
  /^https?:\/\/\S+$/.test(text) ||
  text.startsWith("|")

export const parseUpdateNotes = (
  raw: string | undefined
): UpdateNoteBlock[] => {
  if (!raw) return []

  const blocks: UpdateNoteBlock[] = []

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || /^[-*_]{3,}$/.test(trimmed) || isNoise(trimmed)) continue

    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed)
    if (heading) {
      blocks.push({ kind: "heading", spans: parseNoteSpans(heading[1]) })
      continue
    }

    const item = /^[-*+•]\s+(.+)$/.exec(trimmed)
    if (item) {
      blocks.push({ kind: "item", spans: parseNoteSpans(item[1]) })
      continue
    }

    blocks.push({ kind: "text", spans: parseNoteSpans(trimmed) })
  }

  return blocks
}
