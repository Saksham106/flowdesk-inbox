import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockRunAiJsonFeature, mockUserFindFirst } = vi.hoisted(() => ({
  mockRunAiJsonFeature: vi.fn(),
  mockUserFindFirst: vi.fn(),
}))

vi.mock("@/lib/ai/gateway", () => ({
  runAiJsonFeature: mockRunAiJsonFeature,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mockUserFindFirst },
  },
}))

import { compileRule, RuleCompileError } from "@/lib/agent/rule-compiler"

const OWNER = { id: "owner-1", email: "owner@example.com" }

describe("compileRule", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockUserFindFirst.mockResolvedValue(OWNER)
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "amazon.com" },
        actionJson: { targetAttention: "read_later" },
        confidence: 0.95,
      },
      model: "anthropic/claude-sonnet-4.5",
      providerGenerationId: "gen-1",
    })
  })

  it("compiles domain-based attention rule", async () => {
    const result = await compileRule("t1", "Move all emails from amazon.com to read later")
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson).toEqual({ matchType: "domain", matchValue: "amazon.com" })
    expect(result.actionJson).toEqual({ targetAttention: "read_later" })
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("falls back to regex for simple sender patterns", async () => {
    // Regex fallback: "emails from @newsletter.com → read_later"
    const result = await compileRule("t1", "emails from newsletters@example.com should be quiet")
    // If the AI gateway is not called because regex catches it first,
    // result should still be valid
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson.matchType).toBeDefined()
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("returns low confidence for ambiguous input", async () => {
    mockRunAiJsonFeature.mockResolvedValueOnce({
      output: {
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "example.com" },
        actionJson: { targetAttention: "quiet" },
        confidence: 0.3,
      },
      model: "anthropic/claude-sonnet-4.5",
      providerGenerationId: "gen-1",
    })

    const result = await compileRule("t1", "do something with example emails")
    expect(result.confidence).toBeLessThan(0.5)
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        userId: OWNER.id,
        userEmail: OWNER.email,
        feature: "agent_rule.compile",
      })
    )
  })

  it("throws RuleCompileError 429 when over budget", async () => {
    mockRunAiJsonFeature.mockRejectedValue(
      new Error("Daily AI spend limit reached ($1.00/day). Resets at midnight UTC.")
    )

    const err = await compileRule("t1", "do something with example emails").catch((e) => e)
    expect(err).toBeInstanceOf(RuleCompileError)
    expect(err.status).toBe(429)
  })

  it("throws RuleCompileError 503 when the tenant has no user to attribute the AI call to", async () => {
    mockUserFindFirst.mockResolvedValue(null)

    const err = await compileRule("t1", "do something with example emails").catch((e) => e)
    expect(err).toBeInstanceOf(RuleCompileError)
    expect(err.status).toBe(503)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("throws RuleCompileError 503 for other gateway failures", async () => {
    mockRunAiJsonFeature.mockRejectedValue(new Error("OpenRouter call failed"))

    const err = await compileRule("t1", "do something with example emails").catch((e) => e)
    expect(err).toBeInstanceOf(RuleCompileError)
    expect(err.status).toBe(503)
  })
})
