import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("AgentActivitySection", () => {
  it("accepts quietlyHandledBreakdown prop", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("quietlyHandledBreakdown")
    expect(source).toContain("QuietlyHandledBreakdown")
  })

  it("shows newsletters moved row", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("newsletter")
    expect(source).toContain("Quiet")
  })

  it("does not have needsActionCount", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).not.toContain("needsActionCount")
    expect(source).not.toContain("needing action")
  })

  it("has updated empty state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/AgentActivitySection.tsx"),
      "utf8"
    )
    expect(source).toContain("All quiet")
    expect(source).not.toContain("No agent activity yet")
  })
})
