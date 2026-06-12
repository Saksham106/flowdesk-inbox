// tests/sales-classifier.test.ts
import { describe, it, expect } from "vitest"
import { classifySalesSignals } from "@/lib/agent/sales-classifier"

describe("classifySalesSignals", () => {
  it("returns isSalesLead false for empty messages", () => {
    const result = classifySalesSignals([])
    expect(result.isSalesLead).toBe(false)
    expect(result.closingStage).toBeNull()
    expect(result.suggestedAction).toBe("")
  })

  it("returns isSalesLead false for non-sales messages", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "Hi, just checking in. How are things going?" },
    ])
    expect(result.isSalesLead).toBe(false)
    expect(result.closingStage).toBeNull()
  })

  it("detects prospect stage from budget/pricing mention", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "What is the pricing for your service?" },
    ])
    expect(result.isSalesLead).toBe(true)
    expect(result.closingStage).toBe("prospect")
    expect(result.suggestedAction).toBe("Send intro deck and ask about their timeline")
  })

  it("detects qualified stage from evaluation signals", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We are evaluating several vendors and you are on our shortlist." },
    ])
    expect(result.isSalesLead).toBe(true)
    expect(result.closingStage).toBe("qualified")
    expect(result.suggestedAction).toBe("Schedule a discovery call to confirm budget and requirements")
  })

  it("detects proposal stage from proposal language", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "Could you send us a proposal and scope of work?" },
    ])
    expect(result.isSalesLead).toBe(true)
    expect(result.closingStage).toBe("proposal")
    expect(result.suggestedAction).toBe("Follow up on the proposal and offer to answer questions")
  })

  it("detects closing stage from ready-to-sign language", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We are ready to sign. Please send the contract." },
    ])
    expect(result.isSalesLead).toBe(true)
    expect(result.closingStage).toBe("closing")
    expect(result.suggestedAction).toBe("Send the contract and confirm next steps")
  })

  it("closing stage beats proposal when both signals present", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We reviewed the proposal and are ready to move forward. Send the contract." },
    ])
    expect(result.closingStage).toBe("closing")
  })

  it("proposal stage beats qualified when both signals present", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We are evaluating vendors. Can you send a proposal?" },
    ])
    expect(result.closingStage).toBe("proposal")
  })

  it("qualified stage beats prospect when both signals present", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "Budget is $5000. We have shortlisted you." },
    ])
    expect(result.closingStage).toBe("qualified")
  })

  it("extracts budget string from message", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "Our budget is $10,000 for this project. What is the pricing?" },
    ])
    expect(result.extractedBudget).toBeTruthy()
    expect(result.extractedBudget).toMatch(/\$10/)
  })

  it("extracts timeline from message", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We need this done ASAP. What is the pricing?" },
    ])
    expect(result.isSalesLead).toBe(true)
    expect(result.extractedTimeline).toBeTruthy()
  })

  it("returns null extractedBudget when no dollar amount mentioned", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "We are evaluating and you are shortlisted." },
    ])
    expect(result.extractedBudget).toBeNull()
  })

  it("considers messages from multiple turns", () => {
    const result = classifySalesSignals([
      { direction: "inbound", body: "What is the cost?" },
      { direction: "outbound", body: "It depends on your needs." },
      { direction: "inbound", body: "We are ready to sign the contract." },
    ])
    expect(result.closingStage).toBe("closing")
  })
})
