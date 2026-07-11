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

  it("History prioritizes 20 recent emails with unified label correction", () => {
    const page = source("app/assistant/history/page.tsx")
    const client = source("app/assistant/RecentEmailHistory.tsx")
    expect(page).toContain('where: { tenantId }')
    expect(page).toContain('orderBy: { lastMessageAt: "desc" }')
    expect(page).toContain("take: 20")
    expect(page).toContain("currentFlowDeskLabel")
    expect(page).toContain("Rule change history")
    expect(client).toContain("FLOWDESK_LABEL_OPTIONS")
    expect(client).toContain('/api/conversations/${row.id}/flowdesk-label')
    expect(client).toContain("Adjust")
    expect(client).toContain("Save")
    expect(client).toContain("Cancel")
    expect(client).toContain('aria-live="polite"')
  })
})
