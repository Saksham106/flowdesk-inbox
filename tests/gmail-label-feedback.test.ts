import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockStateUpsert,
  mockStateUpdate,
  mockStateFindUnique,
  mockWritebackFindUnique,
  mockWritebackUpdateMany,
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
  mockWritebackUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockCorrectionCreate: vi.fn(),
  mockMessageFindFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst, update: mockConversationUpdate },
    conversationState: { upsert: mockStateUpsert, update: mockStateUpdate, findUnique: mockStateFindUnique },
    emailWritebackQueue: { findUnique: mockWritebackFindUnique, updateMany: mockWritebackUpdateMany },
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
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
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

  it("keeps an Autodrafted removal as a durable workflow override", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      draft: { status: "proposed" },
      stateRecord: { ...conversation.stateRecord, metadataJson: { gmailLabelOverride: { workflow: "Autodrafted", contentType: null } } },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: [], removed: ["Autodrafted"] }))
      .resolves.toEqual({ applied: true, kind: "removal" })

    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ userState: null, userStateSource: "gmail_label" }),
    })
    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        gmailLabelOverride: expect.objectContaining({ workflow: null }),
      }) }),
    }))
  })

  it("does not accept an Autodrafted addition without an existing draft", async () => {
    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Autodrafted"], removed: [] }))
      .resolves.toEqual({ applied: false, kind: "ignored" })

    expect(mockConversationUpdate).not.toHaveBeenCalled()
    expect(mockStateUpsert).not.toHaveBeenCalled()
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
      id: "writeback-1",
      status: "completed",
      providerMessageIdsJson: { labels: ["Read Later"] },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: false, kind: "ignored" })
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it("ignores the echo of a superseded application recorded in payload history", async () => {
    // Projection A applied [Read Later, Notification]; projection B replaced
    // the payload with [Needs Reply] before A's mailbox echo arrived. The
    // echo must match A's history entry, not be learned as a user edit.
    mockWritebackFindUnique.mockResolvedValue({
      id: "writeback-1",
      status: "pending",
      updatedAt: new Date(),
      providerMessageIdsJson: {
        threadId: "th-1",
        labels: ["Needs Reply"],
        history: [{ labels: ["Read Later", "Notification"], at: new Date(Date.now() - 5_000).toISOString() }],
      },
    })

    await expect(
      applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later", "Notification"], removed: ["Needs Reply"] })
    ).resolves.toEqual({ applied: false, kind: "ignored" })
    expect(mockConversationUpdate).not.toHaveBeenCalled()
    expect(mockStateUpsert).not.toHaveBeenCalled()
  })

  it("still learns an edit matching only a stale history entry", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      id: "writeback-1",
      status: "pending",
      updatedAt: new Date(),
      providerMessageIdsJson: {
        threadId: "th-1",
        labels: ["Needs Reply"],
        history: [{ labels: ["Read Later"], at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }],
      },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: true, kind: "addition" })
  })

  it("ignores a duplicate echo of an already-acknowledged application within the echo window", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      id: "writeback-1",
      status: "acknowledged",
      updatedAt: new Date(),
      providerMessageIdsJson: { threadId: "th-1", labels: ["Read Later"] },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: false, kind: "ignored" })
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it("learns an identical user edit on an acknowledged row once the echo window passed", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      id: "writeback-1",
      status: "acknowledged",
      updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      providerMessageIdsJson: { threadId: "th-1", labels: ["Read Later"] },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: true, kind: "addition" })
  })

  it("treats removal of an active workflow label with no replacement as handled", async () => {
    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: [], removed: ["Needs Reply"] }))
      .resolves.toEqual({ applied: true, kind: "removal" })

    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ status: "closed", userState: "done", userStateSource: "gmail_label" }),
    })
    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        attentionCategory: "fyi_done",
        gmailLabelOverride: expect.objectContaining({ workflow: null }),
      }) }),
    }))
    expect(mockCorrectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ newAttention: "fyi_done" }),
    })
  })

  it("re-opens the conversation when the Handled label is removed", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      status: "closed",
      userState: "done",
      stateRecord: { attentionCategory: "fyi_done", emailType: null, metadataJson: {} },
    })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: [], removed: ["Handled"] }))
      .resolves.toEqual({ applied: true, kind: "removal" })

    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ status: "needs_reply", userState: null, userStateSource: "gmail_label" }),
    })
    expect(mockStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ metadataJson: expect.objectContaining({
        attentionCategory: null,
      }) }),
    }))
  })

  it("learns a later matching manual label edit after consuming FlowDesk's writeback event", async () => {
    mockWritebackFindUnique.mockResolvedValue({
      id: "writeback-1",
      status: "completed",
      providerMessageIdsJson: { labels: ["Read Later"] },
    })
    mockWritebackUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: false, kind: "ignored" })
    await expect(applyGmailLabelFeedback({ tenantId: "t1", conversationId: "c1", added: ["Read Later"], removed: [] }))
      .resolves.toEqual({ applied: true, kind: "addition" })

    expect(mockWritebackUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "writeback-1", status: "completed" },
      data: { status: "acknowledged" },
    })
    expect(mockConversationUpdate).toHaveBeenCalledTimes(1)
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
