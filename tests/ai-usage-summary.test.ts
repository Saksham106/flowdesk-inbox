import { describe, expect, it } from "vitest"

import {
  describeAiFeature,
  startOfDayUtc,
  startOfMonthUtc,
  summarizeAiUsage,
  type AiUsageEventRow,
} from "@/lib/ai/usage-summary"

const now = new Date("2026-07-08T15:30:00.000Z")

function event(overrides: Partial<AiUsageEventRow> = {}): AiUsageEventRow {
  return {
    feature: "chat.inbox",
    estimatedCostUsd: 0.01,
    status: "succeeded",
    createdAt: new Date("2026-07-08T10:00:00.000Z"),
    ...overrides,
  }
}

describe("startOfDayUtc / startOfMonthUtc", () => {
  it("computes UTC boundaries", () => {
    expect(startOfDayUtc(now).toISOString()).toBe("2026-07-08T00:00:00.000Z")
    expect(startOfMonthUtc(now).toISOString()).toBe("2026-07-01T00:00:00.000Z")
  })
})

describe("describeAiFeature", () => {
  it("maps known feature keys to display labels", () => {
    expect(describeAiFeature("chat.inbox")).toBe("Inbox chat")
    expect(describeAiFeature("agent_rule.compile")).toBe("Rule compilation")
    expect(describeAiFeature("agent.classify")).toBe("Email classification")
    expect(describeAiFeature("autopilot.draft")).toBe("Reply drafting")
  })

  it("collapses person_memory sub-statuses into one label", () => {
    expect(describeAiFeature("person_memory.llm")).toBe("Person memory")
    expect(describeAiFeature("person_memory.cache_hit")).toBe("Person memory")
  })

  it("falls back to the raw key for unknown features", () => {
    expect(describeAiFeature("future.feature")).toBe("future.feature")
  })
})

describe("summarizeAiUsage", () => {
  const limits = { dailyLimitUsd: 5, monthlyLimitUsd: 50 }

  it("returns empty features and full remaining budget with no events", () => {
    const summary = summarizeAiUsage([], limits, now)
    expect(summary.features).toEqual([])
    expect(summary.dailyUsedUsd).toBe(0)
    expect(summary.monthlyUsedUsd).toBe(0)
    expect(summary.dailyRemainingUsd).toBe(5)
    expect(summary.monthlyRemainingUsd).toBe(50)
  })

  it("groups costs per feature and splits daily vs monthly windows", () => {
    const summary = summarizeAiUsage(
      [
        event({ estimatedCostUsd: 0.02 }), // today
        event({ estimatedCostUsd: 0.03, createdAt: new Date("2026-07-02T09:00:00.000Z") }), // earlier this month
        event({ feature: "agent_rule.compile", estimatedCostUsd: 0.05 }),
      ],
      limits,
      now
    )

    const chat = summary.features.find((f) => f.feature === "chat.inbox")
    expect(chat?.dailyCostUsd).toBeCloseTo(0.02)
    expect(chat?.monthlyCostUsd).toBeCloseTo(0.05)
    expect(chat?.monthlyCalls).toBe(2)

    const compile = summary.features.find((f) => f.feature === "agent_rule.compile")
    expect(compile?.dailyCostUsd).toBeCloseTo(0.05)
    expect(compile?.monthlyCostUsd).toBeCloseTo(0.05)

    expect(summary.dailyUsedUsd).toBeCloseTo(0.07)
    expect(summary.monthlyUsedUsd).toBeCloseTo(0.1)
    expect(summary.dailyRemainingUsd).toBeCloseTo(4.93)
    expect(summary.monthlyRemainingUsd).toBeCloseTo(49.9)
  })

  it("counts blocked events without adding their cost", () => {
    const summary = summarizeAiUsage(
      [
        event({ estimatedCostUsd: 0.02 }),
        event({ status: "blocked", estimatedCostUsd: 0 }),
        event({ status: "failed", estimatedCostUsd: 0 }),
      ],
      limits,
      now
    )

    const chat = summary.features[0]
    expect(chat.monthlyCalls).toBe(3)
    expect(chat.monthlyBlocked).toBe(1)
    expect(chat.monthlyCostUsd).toBeCloseTo(0.02)
  })

  it("ignores events from before the current month", () => {
    const summary = summarizeAiUsage(
      [event({ createdAt: new Date("2026-06-30T23:59:00.000Z"), estimatedCostUsd: 1 })],
      limits,
      now
    )
    expect(summary.features).toEqual([])
    expect(summary.monthlyUsedUsd).toBe(0)
  })

  it("groups person_memory sub-features into a single row", () => {
    const summary = summarizeAiUsage(
      [
        event({ feature: "person_memory.llm", estimatedCostUsd: 0.01 }),
        event({ feature: "person_memory.cache_hit", estimatedCostUsd: 0 }),
      ],
      limits,
      now
    )
    expect(summary.features).toHaveLength(1)
    expect(summary.features[0].feature).toBe("person_memory")
    expect(summary.features[0].monthlyCalls).toBe(2)
  })

  it("sorts features by monthly cost descending, then label", () => {
    const summary = summarizeAiUsage(
      [
        event({ feature: "agent.classify", estimatedCostUsd: 0.01 }),
        event({ feature: "chat.inbox", estimatedCostUsd: 0.09 }),
        event({ feature: "autopilot.draft", estimatedCostUsd: 0.01 }),
      ],
      limits,
      now
    )
    expect(summary.features.map((f) => f.feature)).toEqual([
      "chat.inbox",
      "agent.classify", // "Email classification" < "Reply drafting"
      "autopilot.draft",
    ])
  })

  it("clamps remaining budget at zero when over the limit", () => {
    const summary = summarizeAiUsage(
      [event({ estimatedCostUsd: 9 })],
      { dailyLimitUsd: 5, monthlyLimitUsd: 8 },
      now
    )
    expect(summary.dailyRemainingUsd).toBe(0)
    expect(summary.monthlyRemainingUsd).toBe(0)
  })
})
