import { beforeEach, describe, expect, it, vi } from "vitest"
import { hasBulkMailSignals } from "@/lib/agent/draft-eligibility"

describe("hasBulkMailSignals", () => {
  it("detects an unsubscribe footer in the body", () => {
    expect(
      hasBulkMailSignals({
        body: "This week's roundup...\n\nTo stop receiving these emails, unsubscribe here.",
      })
    ).toBe(true)
  })

  it("detects a List-Unsubscribe header", () => {
    expect(
      hasBulkMailSignals({
        body: "Join our project by clicking the link below.",
        rawHeaders: "List-Unsubscribe: <mailto:unsub@example.com>",
      })
    ).toBe(true)
  })

  it("returns false for an ordinary human message", () => {
    expect(
      hasBulkMailSignals({
        body: "Hey, can you send over the contract by Friday?",
      })
    ).toBe(false)
  })
})

const {
  mockFindUnique,
  mockUpdate,
  mockAuditCreate,
  mockRunAiJsonFeature,
  mockProjectLabels,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockRunAiJsonFeature: vi.fn(),
  mockProjectLabels: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationState: { findUnique: mockFindUnique, update: mockUpdate },
    auditLog: { create: mockAuditCreate },
  },
}))
vi.mock("@/lib/ai/gateway", () => ({ runAiJsonFeature: mockRunAiJsonFeature }))
vi.mock("@/lib/email-labels", () => ({ projectFlowDeskLabelsForConversation: mockProjectLabels }))

// Import after mocks are registered, matching the existing convention.
const { resolveDraftEligibility } = await import("@/lib/agent/draft-eligibility")

describe("resolveDraftEligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue({ metadataJson: {} })
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockProjectLabels.mockResolvedValue(undefined)
  })

  const baseInput = {
    tenantId: "t1",
    userId: "u1",
    userEmail: "user@example.com",
    conversationId: "conv-1",
    classification: {
      emailType: "needs_reply" as const,
      attentionCategory: "needs_reply" as const,
      confidence: 0.7,
      reason: "Human message likely expects a reply.",
    },
    message: { subject: "Join our beta", body: "We're launching, click here to join the waitlist." },
  }

  it("skips the gate entirely when confidence is above the fallback threshold", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      classification: { ...baseInput.classification, confidence: 0.85 },
    })
    expect(result.eligible).toBe(true)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("skips the gate entirely when emailType is not needs_reply", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      classification: { ...baseInput.classification, emailType: "notification" as const },
    })
    expect(result.eligible).toBe(true)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("rejects deterministically on bulk-mail signals without calling the AI gate", async () => {
    const result = await resolveDraftEligibility({
      ...baseInput,
      message: {
        subject: "Weekly roundup",
        body: "This week's roundup...\n\nTo stop receiving these emails, unsubscribe here.",
      },
    })
    expect(result.eligible).toBe(false)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1" },
        data: expect.objectContaining({
          emailType: "newsletter",
          attentionCategory: "read_later",
          metadataJson: expect.objectContaining({
            emailType: "newsletter",
            attentionCategory: "read_later",
            attentionSource: "draft_gate",
          }),
        }),
      })
    )
    expect(mockProjectLabels).toHaveBeenCalledWith({ tenantId: "t1", conversationId: "conv-1" })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "draft_gate.reclassified" }),
      })
    )
  })

  it("calls the AI gate when deterministic signals are absent, and retags on rejection", async () => {
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        needsReply: false,
        suggestedEmailType: "fyi",
        suggestedAttentionCategory: "quiet",
        reason: "One-way share, no question directed at the recipient.",
      },
      model: "test-model",
      providerGenerationId: null,
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(false)
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", feature: "draft_gate.eligibility" })
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailType: "fyi",
          attentionCategory: "quiet",
          metadataJson: expect.objectContaining({ emailType: "fyi", attentionCategory: "quiet" }),
        }),
      })
    )
  })

  it("does not override an explicit user classification correction", async () => {
    mockFindUnique.mockResolvedValue({
      attentionCategory: "needs_reply",
      metadataJson: { attentionCorrectedByUser: true },
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(true)
    expect(result.reason).toMatch(/explicitly corrected by the user/)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("does not draft when the user explicitly corrected the conversation away from needs reply", async () => {
    mockFindUnique.mockResolvedValue({
      attentionCategory: "read_later",
      metadataJson: { attentionCorrectedByUser: true },
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(false)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("does not override a legacy userOverride correction", async () => {
    mockFindUnique.mockResolvedValue({ metadataJson: { userOverride: true } })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(true)
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("respects the AI gate when it agrees a reply is needed", async () => {
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        needsReply: true,
        suggestedEmailType: "needs_reply",
        suggestedAttentionCategory: "needs_reply",
        reason: "Direct question awaiting an answer.",
      },
      model: "test-model",
      providerGenerationId: null,
    })

    const result = await resolveDraftEligibility(baseInput)

    expect(result.eligible).toBe(true)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
