#!/usr/bin/env node
/**
 * Builds the in-app "what's new" notes shown by the launcher's update screen.
 *
 * The GitHub release body is written for someone downloading an installer, so
 * it talks about DMGs, Gatekeeper and download links. The app's update screen
 * only needs the changes, so this turns the conventional-commit subjects
 * between the previous tag and the tag being released into grouped bullets.
 *
 * Usage:
 *   node build-update-notes.mjs --from v1.1.1 --to v1.1.2 --output update-notes.md
 *
 * `--from` may be empty for the first release, in which case the whole
 * history reachable from `--to` is used (capped, see MAX_COMMITS).
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const MAX_COMMITS = 200

function arg(name, { required = true } = {}) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1 || !process.argv[idx + 1]) {
    if (!required) return ""
    console.error(`Missing required --${name} argument`)
    process.exit(1)
  }
  return process.argv[idx + 1]
}

const from = arg("from", { required: false })
const to = arg("to")
const output = arg("output")

// Ordering of the groups, and the label each conventional-commit type maps to.
// Anything unlisted (style, test, build, ci, chore, revert, ...) lands in the
// trailing group so a release never silently drops a change.
const GROUPS = [
  { label: "新功能", types: ["feat"] },
  { label: "修复", types: ["fix"] },
  { label: "性能", types: ["perf"] },
  { label: "重构", types: ["refactor"] },
  { label: "文档", types: ["docs"] },
  { label: "维护", types: [] }, // fallback bucket
]

// `chore(release): bump desktop app to 1.1.2` and the like only restate the
// version being shipped; they carry no information for the reader.
const SKIP = /^(chore\(release\)|release|v?\d+\.\d+\.\d+$)/i

// Debug scaffolding ("临时权限探针", "tmp", "wip") is added and removed within
// the same release and never reaches users as a feature, so it should not
// reach the update screen either. Heuristic: reword the commit (or extend this
// list) if it ever hides a change worth announcing.
const TRANSIENT = /临时|探针|\bwip\b|\btmp\b|\btemporary\b/i
const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/

const range = from ? `${from}..${to}` : to
const raw = execFileSync(
  "git",
  ["log", range, "--no-merges", `--max-count=${MAX_COMMITS}`, "--pretty=format:%s"],
  { encoding: "utf8" }
)

const buckets = new Map(GROUPS.map((group) => [group.label, []]))

let total = 0
for (const subject of raw.split("\n").map((line) => line.trim()).filter(Boolean)) {
  if (SKIP.test(subject) || TRANSIENT.test(subject)) continue

  const match = CONVENTIONAL.exec(subject)
  const type = match ? match[1].toLowerCase() : ""
  const description = (match ? match[3] : subject).trim()

  const group =
    GROUPS.find((candidate) => candidate.types.includes(type)) ??
    GROUPS[GROUPS.length - 1]

  // Scope (common/desktop/...) is internal jargon on the update screen: the
  // reader has no idea what "common" is. Description only.
  buckets.get(group.label).push(description)
  total += 1
}

const sections = []
for (const { label } of GROUPS) {
  const items = buckets.get(label)
  if (items.length === 0) continue
  sections.push(`### ${label}\n${items.map((item) => `- ${item}`).join("\n")}`)
}

const body =
  sections.length > 0
    ? `${sections.join("\n\n")}\n`
    : "### 维护\n- 常规维护更新\n"

writeFileSync(output, body)
console.log(`Wrote ${total} change(s) to ${output}`)
if (from) console.log(`Range: ${range}`)
