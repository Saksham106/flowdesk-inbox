import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ai/openai-provider", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}))

import { compileRule } from "@/lib/agent/rule-compiler"
import { openai } from "@/lib/ai/openai-provider"

const mockCreate = vi.mocked(openai.chat.completions.create)

describe("compileRule", () => {
  beforeEach(() => vi.resetAllMocks())

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

    const result = await compileRule("Move all emails from amazon.com to read later")
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson).toEqual({ matchType: "domain", matchValue: "amazon.com" })
    expect(result.actionJson).toEqual({ targetAttention: "read_later" })
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("falls back to regex for simple sender patterns", async () => {
    // Regex fallback: "emails from @newsletter.com → read_later"
    const result = await compileRule("emails from newsletters@example.com should be quiet")
    // If OpenAI is mocked to not be called because regex catches it first,
    // result should still be valid
    expect(result.ruleType).toBe("attention")
    expect(result.conditionsJson.matchType).toBeDefined()
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

    const result = await compileRule("do something with example emails")
    expect(result.confidence).toBeLessThan(0.5)
  })
})
