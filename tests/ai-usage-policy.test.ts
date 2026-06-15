import { describe, expect, it } from "vitest"

import { evaluatePersonMemoryPolicy } from "@/lib/ai/usage-policy"

const baseConversation = {
  id: "conv-1",
  label: null,
  status: "needs_reply",
  contactId: "contact-1",
  messages: [
    {
      direction: "inbound",
      body: "Could you send pricing for next week?",
    },
  ],
}

describe("evaluatePersonMemoryPolicy", () => {
  it("skips quiet automated and marketing conversations", () => {
    const decision = evaluatePersonMemoryPolicy({
      conversation: baseConversation,
      accountType: "business",
      emailClassification: {
        emailType: "marketing",
        attentionCategory: "quiet",
        reason: "Promotional email.",
        confidence: 0.95,
      },
      isSalesLead: false,
      isSupport: false,
    })

    expect(decision.shouldRunLLM).toBe(false)
    expect(decision.tier).toBe(0)
    expect(decision.reason).toMatch(/quiet|low-value/i)
  })

  it("skips transactional OTP and password emails even when they need action", () => {
    const decision = evaluatePersonMemoryPolicy({
      conversation: baseConversation,
      accountType: "personal",
      emailClassification: {
        emailType: "notification",
        attentionCategory: "needs_action",
        reason: "Verification code.",
        confidence: 0.96,
        action: {
          type: "otp_code",
          explanation: "Use the verification code.",
          detectedCode: "482910",
        },
      },
      isSalesLead: false,
      isSupport: false,
    })

    expect(decision.shouldRunLLM).toBe(false)
    expect(decision.tier).toBe(1)
    expect(decision.reason).toMatch(/transactional/i)
  })

  it("allows relationship memory for real human emails that need a reply", () => {
    const decision = evaluatePersonMemoryPolicy({
      conversation: baseConversation,
      accountType: "business",
      emailClassification: {
        emailType: "needs_reply",
        attentionCategory: "needs_reply",
        reason: "Human reply request.",
        confidence: 0.82,
      },
      isSalesLead: false,
      isSupport: false,
    })

    expect(decision.shouldRunLLM).toBe(true)
    expect(decision.tier).toBe(2)
  })

  it("allows richer memory for sales and support conversations", () => {
    const decision = evaluatePersonMemoryPolicy({
      conversation: baseConversation,
      accountType: "business",
      emailClassification: {
        emailType: "needs_reply",
        attentionCategory: "needs_reply",
        reason: "Pricing request.",
        confidence: 0.88,
      },
      isSalesLead: true,
      isSupport: false,
    })

    expect(decision.shouldRunLLM).toBe(true)
    expect(decision.tier).toBe(3)
  })
})
