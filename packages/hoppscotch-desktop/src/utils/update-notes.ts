/**
 * Update notes are the `notes` field of the update manifest, rendered inside
 * the launcher window (500x700). They get parsed into blocks rather than
 * rendered as markdown: the window carries no markdown stylesheet, and
 * `v-html` on remotely-served text would buy nothing here.
 *
 * `.github/scripts/build-update-notes.mjs` writes `### <group>` headings
 * followed by `- <commit subject>` items, but releases made before that
 * script existed carry whole GitHub release notes (download tables, Gatekeeper
 * instructions, a workflow link). Anything that does not match the expected
 * shape degrades to a paragraph instead of breaking the screen.
 */
export type UpdateNoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string }
  | { kind: "text"; text: string }

// Markdown emphasis, links and code spans are noise in this UI; keep the text.
const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .trim()

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
      blocks.push({ kind: "heading", text: stripInlineMarkdown(heading[1]) })
      continue
    }

    const item = /^[-*+•]\s+(.+)$/.exec(trimmed)
    if (item) {
      blocks.push({ kind: "item", text: stripInlineMarkdown(item[1]) })
      continue
    }

    blocks.push({ kind: "text", text: stripInlineMarkdown(trimmed) })
  }

  return blocks
}
