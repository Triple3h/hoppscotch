import { describe, expect, test } from "vitest"
import { parseUpdateNotes } from "../update-notes"

describe("parseUpdateNotes", () => {
  test("splits headings into groups and keeps their bullets in order", () => {
    const notes = [
      "### 新功能",
      "- 事件详情支持折叠查看",
      "- 设置页显示当前版本",
      "",
      "### 修复",
      "- 修复打开事件详情时列表宽度跳动",
    ].join("\n")

    expect(parseUpdateNotes(notes)).toEqual([
      {
        title: "新功能",
        items: ["事件详情支持折叠查看", "设置页显示当前版本"],
      },
      { title: "修复", items: ["修复打开事件详情时列表宽度跳动"] },
    ])
  })

  test("keeps text that is neither a heading nor a bullet", () => {
    expect(parseUpdateNotes("常规维护更新")).toEqual([
      { title: "", items: ["常规维护更新"] },
    ])
  })

  test("reads notes with no notes at all as nothing to show", () => {
    expect(parseUpdateNotes(undefined)).toEqual([])
    expect(parseUpdateNotes("")).toEqual([])
    expect(parseUpdateNotes("\n\n")).toEqual([])
  })
})
