import { describe, expect, it } from "vitest"
import { plannedLabelsForRuleAction, summarizeAssistantRules } from "@/lib/assistant-rule-view"

describe("plannedLabelsForRuleAction", () => {
  it("maps targetAttention to visible Gmail labels", () => {
    expect(plannedLabelsForRuleAction({ targetAttention: "read_later" })).toEqual(["Read Later"])
    expect(plannedLabelsForRuleAction({ targetAttention: "needs_action" })).toEqual(["Needs Action"])
  })
})

describe("summarizeAssistantRules", () => {
  it("counts active, draft, learned, and manual rules", () => {
    expect(summarizeAssistantRules([
      { status: "active", source: "manual", lastDryRunAt: null },
      { status: "draft", source: "manual", lastDryRunAt: "2026-07-09T00:00:00.000Z" },
      { status: "active", source: "learned", lastDryRunAt: null },
    ])).toEqual({
      active: 2,
      draft: 1,
      manual: 2,
      learned: 1,
      lastDryRunAt: "2026-07-09T00:00:00.000Z",
    })
  })
})
