import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockFindFirstConversation,
  mockUpsertDraft,
  mockUpdateConversation,
  mockAuditCreate,
  mockEnsureApproval,
  mockQueueWriteback,
  mockProjectLabels,
  mockResolveEligibility,
  mockGetReplyContext,
  mockGenerateDraftReply,
  mockRunAiJsonFeature,
  mockFindFirstUser,
} = vi.hoisted(() => ({
  mockFindFirstConversation: vi.fn(),
  mockUpsertDraft: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockEnsureApproval: vi.fn(),
  mockQueueWriteback: vi.fn(),
  mockProjectLabels: vi.fn(),
  mockResolveEligibility: vi.fn(),
  mockGetReplyContext: vi.fn(),
  mockGenerateDraftReply: vi.fn(),
  mockRunAiJsonFeature: vi.fn(),
  mockFindFirstUser: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockFindFirstConversation, update: mockUpdateConversation },
    draft: { upsert: mockUpsertDraft },
    auditLog: { create: mockAuditCreate },
    agentJob: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findFirst: mockFindFirstUser },
  },
}))
vi.mock("@/lib/agent/approvals", () => ({ ensureDraftApprovalRequest: mockEnsureApproval }))
vi.mock("@/lib/gmail-drafts", () => ({
  queueGmailDraftWriteback: mockQueueWriteback,
  latestMeaningfulInboundMessage: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/gmail-labels", () => ({ projectFlowDeskLabelsForConversation: mockProjectLabels }))
vi.mock("@/lib/agent/draft-eligibility", () => ({ resolveDraftEligibility: mockResolveEligibility }))
vi.mock("@/lib/agent/reply-context", () => ({ getReplyGenerationContext: mockGetReplyContext }))
vi.mock("@/lib/ai/provider", () => ({ generateDraftReply: mockGenerateDraftReply }))
// The default fixture below uses accountType: "personal", which drives the
// runAiJsonFeature path (not generateDraftReply) in proposeDraftForConversation.
// This mock is not in the task brief's reconstruction but is required for the
// personal-account branch to avoid hitting the real AI gateway (budget checks,
// OpenRouter key provisioning, network calls) during these tests.
vi.mock("@/lib/ai/gateway", () => ({ runAiJsonFeature: mockRunAiJsonFeature }))
vi.mock("@/lib/cache-tags", () => ({ revalidateInboxViews: vi.fn() }))

const { proposeDraftForConversation } = await import("@/lib/agent/draft-generation")

describe("proposeDraftForConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstConversation.mockResolvedValue({
      id: "conv-1",
      tenantId: "t1",
      channelId: "ch1",
      contactId: null,
      channel: { type: "email", provider: "google" },
      externalThreadId: "thread-1",
      messages: [
        { direction: "inbound", body: "Can we meet Tuesday?", createdAt: new Date(), providerMessageId: "m1" },
      ],
      draft: null,
    })
    mockGetReplyContext.mockResolvedValue({
      accountType: "personal",
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile: null,
      writingPreferences: null,
    })
    mockGenerateDraftReply.mockResolvedValue({
      draftText: "Tuesday works for me.",
      intent: "reply",
      confidence: 0.8,
      riskLevel: "low",
      suggestedLabel: null,
      escalationReason: null,
      citedDocumentIds: [],
      model: "test-model",
    })
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        draftText: "Tuesday works for me.",
        intent: "reply",
        confidence: 0.8,
        riskLevel: "low",
        suggestedLabel: null,
        escalationReason: null,
        citedDocumentIds: [],
      },
      model: "test-model",
    })
    mockResolveEligibility.mockResolvedValue({ eligible: true, reason: "ok" })
    mockFindFirstUser.mockResolvedValue({ id: "u1", email: "user@example.com" })
    mockUpsertDraft.mockResolvedValue({ id: "draft-1", text: "Tuesday works for me.", status: "proposed" })
    mockUpdateConversation.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockEnsureApproval.mockResolvedValue({})
    mockQueueWriteback.mockResolvedValue({})
    mockProjectLabels.mockResolvedValue(undefined)
  })

  it("skips the eligibility gate for source: manual", async () => {
    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "manual",
    })
    expect(mockResolveEligibility).not.toHaveBeenCalled()
    expect(result.status).toBe("drafted")
  })

  it("runs the eligibility gate for source: automatic and skips drafting when ineligible", async () => {
    mockResolveEligibility.mockResolvedValue({ eligible: false, reason: "newsletter" })

    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "automatic",
    })

    expect(mockResolveEligibility).toHaveBeenCalled()
    expect(mockUpsertDraft).not.toHaveBeenCalled()
    expect(result).toEqual({ status: "gated_out", reason: "newsletter" })
  })

  it("drafts when the gate approves for source: automatic", async () => {
    const result = await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "automatic",
    })

    expect(result.status).toBe("drafted")
    expect(mockUpsertDraft).toHaveBeenCalled()
    expect(mockQueueWriteback).toHaveBeenCalled()
  })

  it("resolves tenant user context for automatic AI calls", async () => {
    await proposeDraftForConversation({
      tenantId: "t1",
      conversationId: "conv-1",
      source: "automatic",
    })

    expect(mockFindFirstUser).toHaveBeenCalledWith({
      where: { tenantId: "t1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    })
    expect(mockResolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", userEmail: "user@example.com" })
    )
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", userEmail: "user@example.com" })
    )
  })

  it("checks eligibility against the latest inbound message", async () => {
    mockFindFirstConversation.mockResolvedValue({
      id: "conv-1",
      tenantId: "t1",
      channelId: "ch1",
      contactId: null,
      channel: { type: "email", provider: "google" },
      externalThreadId: "thread-1",
      messages: [
        {
          direction: "inbound",
          subject: "Old promotion",
          body: "Shop our launch sale",
          createdAt: new Date("2026-01-01"),
          providerMessageId: "m1",
        },
        {
          direction: "outbound",
          subject: "Re: Old promotion",
          body: "Thanks",
          createdAt: new Date("2026-01-02"),
          providerMessageId: "m2",
        },
        {
          direction: "inbound",
          subject: "Question",
          body: "Can you send the contract?",
          createdAt: new Date("2026-01-03"),
          providerMessageId: "m3",
        },
      ],
      draft: null,
    })

    await proposeDraftForConversation({ tenantId: "t1", conversationId: "conv-1", source: "automatic" })

    expect(mockResolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({
        message: { subject: "Question", body: "Can you send the contract?" },
      })
    )
  })

  it("sanitizes the draft text before saving, recording auto-fixes in metadata", async () => {
    // accountType is "personal" by default (see beforeEach), which routes
    // through runAiJsonFeature rather than generateDraftReply.
    //
    // Deviation from the brief's fixture: the brief used "Sounds good." (12
    // chars) as the surviving text, but the real sanitizeDraftText (Task 1,
    // tests/draft-sanitizer.test.ts) treats any result at-or-under
    // MIN_VIABLE_LENGTH (12) combined with a >40% stripped fraction as
    // "strip_too_aggressive" and reverts to the original, unstripped text —
    // so the brief's fixture would never exercise the auto-fix path it's
    // testing. Using a longer surviving sentence keeps this test meaningful.
    mockRunAiJsonFeature.mockResolvedValue({
      output: {
        draftText: "Sounds good, see you then.\n\nOn Mon wrote:\n> original message",
        intent: "reply",
        confidence: 0.8,
        riskLevel: "low",
        suggestedLabel: null,
        escalationReason: null,
        citedDocumentIds: [],
      },
      model: "test-model",
    })

    await proposeDraftForConversation({ tenantId: "t1", conversationId: "conv-1", source: "manual" })

    expect(mockUpsertDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          text: "Sounds good, see you then.",
          metadataJson: expect.objectContaining({ sanitizerAutoFixed: ["quoted_thread"] }),
        }),
      })
    )
  })
})
