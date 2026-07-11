import { describe, expect, it } from "vitest"
import {
  buildDraftEligibilityPrompt,
  normalizeDraftEligibilityOutput,
} from "@/lib/ai/prompts/draft-eligibility"

describe("buildDraftEligibilityPrompt", () => {
  it("includes the subject and body in the prompt", () => {
    const prompt = buildDraftEligibilityPrompt({
      subject: "Join our beta",
      body: "We're launching a new feature, click here to join the waitlist.",
    })
    expect(prompt).toContain("Join our beta")
    expect(prompt).toContain("click here to join the waitlist")
  })
})

describe("normalizeDraftEligibilityOutput", () => {
  it("parses a valid needsReply=false response", () => {
    const result = normalizeDraftEligibilityOutput(
      JSON.stringify({
        needsReply: false,
        suggestedEmailType: "newsletter",
        suggestedAttentionCategory: "read_later",
        reason: "One-way product announcement, no question directed at the recipient.",
      })
    )
    expect(result.needsReply).toBe(false)
    expect(result.suggestedEmailType).toBe("newsletter")
    expect(result.suggestedAttentionCategory).toBe("read_later")
  })

  it("parses a valid needsReply=true response", () => {
    const result = normalizeDraftEligibilityOutput(
      JSON.stringify({
        needsReply: true,
        suggestedEmailType: "needs_reply",
        suggestedAttentionCategory: "needs_reply",
        reason: "Sender is asking a direct question awaiting the recipient's answer.",
      })
    )
    expect(result.needsReply).toBe(true)
  })

  it("throws on invalid JSON", () => {
    expect(() => normalizeDraftEligibilityOutput("not json")).toThrow()
  })

  it("throws on an invalid suggestedEmailType", () => {
    expect(() =>
      normalizeDraftEligibilityOutput(
        JSON.stringify({
          needsReply: false,
          suggestedEmailType: "not_a_real_type",
          suggestedAttentionCategory: "read_later",
          reason: "x",
        })
      )
    ).toThrow()
  })
})
