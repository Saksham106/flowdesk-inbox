import { describe, it, expect } from "vitest"
import {
  classifySupportSignals,
  type SupportClassifierMessage,
  type SupportClassifierKbDoc,
} from "@/lib/agent/support-classifier"

const SUPPORT_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "This is broken and still not working after 3 days." },
  { direction: "outbound", body: "We're looking into it." },
]

const CHURN_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "I'm frustrated and thinking of cancellation." },
]

const NORMAL_MSGS: SupportClassifierMessage[] = [
  { direction: "inbound", body: "Hi, when are you open?" },
]

const KB_DOCS: SupportClassifierKbDoc[] = [
  {
    id: "doc-1",
    title: "Refund Policy",
    content: "To request a refund please contact support within 30 days of purchase.",
  },
  {
    id: "doc-2",
    title: "Pricing FAQ",
    content: "Our pricing starts at $49 per month with annual billing options available.",
  },
]

describe("classifySupportSignals", () => {
  it("detects support from keyword pattern", () => {
    const result = classifySupportSignals(SUPPORT_MSGS, [])
    expect(result.isSupport).toBe(true)
  })

  it("detects support from label override", () => {
    const result = classifySupportSignals(NORMAL_MSGS, [], "Support")
    expect(result.isSupport).toBe(true)
  })

  it("returns isSupport false for normal messages", () => {
    const result = classifySupportSignals(NORMAL_MSGS, [])
    expect(result.isSupport).toBe(false)
  })

  it("detects churn risk when support + cancellation language", () => {
    const result = classifySupportSignals(CHURN_MSGS, [])
    expect(result.isSupport).toBe(true)
    expect(result.churnRisk).toBe(true)
  })

  it("does not flag churn risk without support signal", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I am thinking of cancellation." },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.churnRisk).toBe(false)
  })

  it("detects escalation when churn + sensitive topic", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "This is broken and I am angry and want to cancel. This is a legal matter.",
      },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.needsEscalation).toBe(true)
  })

  it("returns needsEscalation false without churn risk", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I have a legal question about pricing." },
    ]
    const result = classifySupportSignals(msgs, [])
    expect(result.needsEscalation).toBe(false)
  })

  it("matches KB doc by keyword overlap >= 3", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "I need to request a refund for my purchase within days." },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-1")
  })

  it("returns null suggestedKbDocId when overlap < 3", () => {
    const msgs: SupportClassifierMessage[] = [
      { direction: "inbound", body: "Hello there." },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBeNull()
  })

  it("returns null suggestedKbDocId when no KB docs", () => {
    const result = classifySupportSignals(SUPPORT_MSGS, [])
    expect(result.suggestedKbDocId).toBeNull()
  })

  it("picks the doc with the highest overlap when multiple match", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "I want to request a refund contact support within days purchase.",
      },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-1")
  })

  it("only considers the last inbound message for KB matching", () => {
    const msgs: SupportClassifierMessage[] = [
      {
        direction: "inbound",
        body: "I want to request a refund contact support within days purchase.",
      },
      { direction: "outbound", body: "We'll look into this." },
      { direction: "inbound", body: "What is the pricing monthly annual billing options?" },
    ]
    const result = classifySupportSignals(msgs, KB_DOCS)
    expect(result.suggestedKbDocId).toBe("doc-2")
  })
})
