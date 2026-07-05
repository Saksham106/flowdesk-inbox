import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCreate, mockCheckAiBudgetForTokens, mockRecordAiUsageEvent } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCheckAiBudgetForTokens: vi.fn(),
  mockRecordAiUsageEvent: vi.fn(),
}))

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  checkAiBudgetForTokens: mockCheckAiBudgetForTokens,
}))

vi.mock("@/lib/ai/usage", () => ({
  estimateTokenCount: (value: string) => Math.ceil(value.length / 4),
  recordAiUsageEvent: mockRecordAiUsageEvent,
}))

import { compileRule, RuleCompileError } from "@/lib/agent/rule-compiler"

describe("compileRule", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OPENAI_API_KEY = "test-key"
    delete process.env.OPENAI_MODEL
    mockCheckAiBudgetForTokens.mockResolvedValue({ allowed: true, reason: "Within budget", estimatedCostUsd: 0 })
    mockRecordAiUsageEvent.mockResolvedValue(undefined)
  })

  it("compiles domain-based attention rule", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            ruleType: "attention",
            conditionsJson: { matchType: "domain", matchValue: "amazon.com" },
            actionJson: { targetAttention: "read_later" },
            confidence: 0.95,
          }),
        },
      }],
    } as never)

    const result = await compileRule("t1", "Move all emails from amazon.com to read later")
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson).toEqual({ matchType: "domain", matchValue: "amazon.com" })
    expect(result.actionJson).toEqual({ targetAttention: "read_later" })
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("falls back to regex for simple sender patterns", async () => {
    // Regex fallback: "emails from @newsletter.com → read_later"
    const result = await compileRule("t1", "emails from newsletters@example.com should be quiet")
    // If OpenAI is mocked to not be called because regex catches it first,
    // result should still be valid
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson.matchType).toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCheckAiBudgetForTokens).not.toHaveBeenCalled()
  })

  it("returns low confidence for ambiguous input", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            ruleType: "attention",
            conditionsJson: { matchType: "domain", matchValue: "example.com" },
            actionJson: { targetAttention: "quiet" },
            confidence: 0.3,
          }),
        },
      }],
    } as never)

    const result = await compileRule("t1", "do something with example emails")
    expect(result.confidence).toBeLessThan(0.5)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.4-mini" }))
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", feature: "agent_rule.compile", status: "succeeded" })
    )
  })

  it("respects OPENAI_MODEL for the LLM path", async () => {
    process.env.OPENAI_MODEL = "gpt-custom"
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] } as never)

    await compileRule("t1", "do something with example emails")
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-custom" }))
  })

  it("throws RuleCompileError 429 and records blocked usage when over budget", async () => {
    mockCheckAiBudgetForTokens.mockResolvedValue({
      allowed: false,
      reason: "Daily AI spend limit reached ($1.00/day). Resets at midnight UTC.",
      estimatedCostUsd: 0.01,
    })

    const err = await compileRule("t1", "do something with example emails").catch((e) => e)
    expect(err).toBeInstanceOf(RuleCompileError)
    expect(err.status).toBe(429)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", feature: "agent_rule.compile", status: "blocked" })
    )
  })

  it("throws RuleCompileError 503 when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY

    const err = await compileRule("t1", "do something with example emails").catch((e) => e)
    expect(err).toBeInstanceOf(RuleCompileError)
    expect(err.status).toBe(503)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
