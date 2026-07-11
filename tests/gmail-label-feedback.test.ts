import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockStateUpsert,
  mockStateUpdate,
  mockStateFindUnique,
  mockWritebackFindUnique,
  mockAuditCreate,
  mockCorrectionCreate,
  mockMessageFindFirst,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockStateUpsert: vi.fn(),
  mockStateUpdate: vi.fn(),
  mockStateFindUnique: vi.fn(),
  mockWritebackFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockCorrectionCreate: vi.fn(),
  mockMessageFindFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst, update: mockConversationUpdate },
    conversationState: { upsert: mockStateUpsert, update: mockStateUpdate, findUnique: mockStateFindUnique },
    gmailWritebackQueue: { findUnique: mockWritebackFindUnique },
    auditLog: { create: mockAuditCreate },
    classificationCorrection: { create: mockCorrectionCreate },
    message: { findFirst: mockMessageFindFirst },
  },
}))

import { applyGmailLabelFeedback, clearGmailLabelOverride, hasGmailLabelOverride } from "@/lib/agent/gmail-label-feedback"

const conversation = {
  id: "c1",
  status: "needs_reply",
  userState: "needs_reply",
  draft: null,
  stateRecord: {
    attentionCategory: "needs_reply",
    emailType: null,
    metadataJson: { existing: true },
  },
}

describe("applyGmailLabelFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationFindFirst.mockResolvedValue(conversation)
    mockWritebackFindUnique.mockResolvedValue(null)
    mockConversationUpdate.mockResolvedValue({})
    mockStateUpsert.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockMessageFindFirst.mockResolvedValue({ fromE164: "sender@example.com" })
    mockCorrectionCreate.mockResolvedValue({})
  })

  it("applies a Gmail-added workflow label as a user correction", async () => {
    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: true, kind: "addition" })

    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ status: "needs_reply", userState: "read_later", userStateSource: "gmail_label" }),
    })
    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        gmailLabelOverride: expect.objectContaining({ workflow: "Read Later", contentType: null }),
      }) }),
    }))
    expect(mockCorrectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t1", conversationId: "c1", newAttention: "read_later" }),
    })
  })

  it("clears a removed workflow label without reapplying it", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      userState: "needs_reply",
      stateRecord: { ...conversation.stateRecord, metadataJson: { gmailLabelOverride: { workflow: "Needs Reply", contentType: null } } },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: [], removed: ["Needs Reply"] }))
      .resolves.toEqual({ applied: true, kind: "removal" })

    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        gmailLabelOverride: expect.objectContaining({ workflow: null }),
      }) }),
    }))
  })

  it("clears only the content override when a content label is removed", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      stateRecord: {
        attentionCategory: "quiet",
        emailType: "newsletter",
        metadataJson: { gmailLabelOverride: { workflow: null, contentType: "Newsletter" } },
      },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: [], removed: ["Newsletter"] }))
      .resolves.toEqual({ applied: true, kind: "removal" })

    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        gmailLabelOverride: expect.objectContaining({ workflow: null, contentType: null }),
      }) }),
    }))
  })

  it("ignores a history event from FlowDesk's completed label writeback", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      status: "completed",
      providerMessageIdsJson: { labels: ["Read Later"] },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: false, kind: "ignored" })
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })
})

describe("hasGmailLabelOverride", () => {
  it("recognizes a present Gmail label override", () => {
    expect(hasGmailLabelOverride({ gmailLabelOverride: { workflow: null, contentType: "Newsletter" } })).toBe(true)
    expect(hasGmailLabelOverride({ gmailLabelOverride: { workflow: null, contentType: null, updatedAt: "2026-07-11T12:00:00.000Z" } })).toBe(true)
    expect(hasGmailLabelOverride({})).toBe(false)
  })
})

describe("clearGmailLabelOverride", () => {
  it("clears the hold when a newer inbound message arrives", async () => {
    mockStateFindUnique.mockResolvedValue({
      metadataJson: { existing: true, gmailLabelOverride: { workflow: "Read Later", contentType: null } },
    })
    mockStateUpdate.mockResolvedValue({})

    await expect(clearGmailLabelOverride({ tenantId: "t1", conversationId: "c1" })).resolves.toBe(true)

    expect(mockStateUpdate).toHaveBeenCalledWith({
      where: { conversationId: "c1" },
      data: { metadataJson: { existing: true } },
    })
  })
})
