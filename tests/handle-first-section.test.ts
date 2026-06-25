import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("HandleFirstSection", () => {
  it("has Snooze button and SNOOZE_PRESETS", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("SNOOZE_PRESETS")
    expect(source).toContain("Tonight (8 pm)")
    expect(source).toContain("Tomorrow morning")
    expect(source).toContain("Next week")
    expect(source).toContain("/api/conversations/${item.id}/snooze")
  })

  it("has Waiting On button calling workflow-status", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("Waiting On")
    expect(source).toContain('workflowStatus: "waiting_on"')
  })

  it("has inline undo after marking done", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).toContain("undoable")
    expect(source).toContain("undoTimerRef")
    expect(source).toContain('workflowStatus: "needs_reply"')
    expect(source).toContain("Undo")
  })

  it("does not contain Mark Done", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/HandleFirstSection.tsx"),
      "utf8"
    )
    expect(source).not.toContain("Mark Done")
  })
})
