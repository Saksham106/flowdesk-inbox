import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(path, "utf8")
}

describe("Assistant UI contracts", () => {
  it("does not use AppSidebar in Assistant layout", () => {
    expect(source("app/assistant/layout.tsx")).not.toContain("AppSidebar")
  })

  it("Test Rules uses a rule select instead of raw Rule ID input", () => {
    const page = source("app/assistant/test-rules/page.tsx")
    expect(page).toContain("TestRulesClient")
    expect(page).not.toContain('placeholder="Rule ID"')
  })

  it("Rules page renders action chips and real rule summaries", () => {
    const page = source("app/assistant/rules/page.tsx")
    expect(page).toContain("Active rules")
    expect(page).toContain("Label as")
  })

  it("History page uses readable rule history presenter", () => {
    expect(source("app/assistant/history/page.tsx")).toContain("RuleHistoryList")
    expect(source("lib/assistant-rule-view.ts")).toContain("describeRuleAuditAction")
  })
})
