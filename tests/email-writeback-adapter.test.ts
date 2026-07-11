import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindMany,
  mockWritebackFindUnique,
  mockWritebackUpdate,
  mockWritebackUpdateMany,
  mockChannelFindUnique,
  mockDraftFindUnique,
  mockDraftUpdate,
  mockAuditCreate,
  mockApplyFlowDeskLabelsToGmailThread,
  mockApplyFlowDeskCategoriesToConversation,
  mockMarkOutlookConversationRead,
  mockCreateOutlookDraftReply,
  mockDeleteOutlookDraft,
} = vi.hoisted(() => ({
  mockWritebackFindMany: vi.fn(),
  mockWritebackFindUnique: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockWritebackUpdateMany: vi.fn(),
  mockChannelFindUnique: vi.fn(),
  mockDraftFindUnique: vi.fn(),
  mockDraftUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockApplyFlowDeskLabelsToGmailThread: vi.fn(),
  mockApplyFlowDeskCategoriesToConversation: vi.fn(),
  mockMarkOutlookConversationRead: vi.fn(),
  mockCreateOutlookDraftReply: vi.fn(),
  mockDeleteOutlookDraft: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: {
      findMany: mockWritebackFindMany,
      findUnique: mockWritebackFindUnique,
      update: mockWritebackUpdate,
      updateMany: mockWritebackUpdateMany,
    },
    channel: { findUnique: mockChannelFindUnique },
    draft: { findUnique: mockDraftFindUnique, update: mockDraftUpdate },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
  GMAIL_WRITEBACK_MAX_ATTEMPTS: 3,
  nextWritebackAttemptDate: (attempts: number) =>
    new Date(Date.parse("2026-07-06T00:00:00Z") + attempts * 60_000),
  applyFlowDeskLabelsToGmailThread: mockApplyFlowDeskLabelsToGmailThread,
  markGmailThreadRead: vi.fn(),
  createGmailDraftForThread: vi.fn(),
  deleteGmailDraft: vi.fn(),
  ensureFlowDeskLabels: vi.fn(),
  archiveGmailThread: vi.fn(),
  unarchiveGmailThread: vi.fn(),
  trashGmailThread: vi.fn(),
}))

vi.mock("@/lib/outlook-mailbox", () => ({
  applyFlowDeskCategoriesToConversation: mockApplyFlowDeskCategoriesToConversation,
  markOutlookConversationRead: mockMarkOutlookConversationRead,
  createOutlookDraftReply: mockCreateOutlookDraftReply,
  deleteOutlookDraft: mockDeleteOutlookDraft,
  ensureFlowDeskCategories: vi.fn(),
  archiveOutlookConversation: vi.fn(),
  restoreOutlookConversation: vi.fn(),
  trashOutlookConversation: vi.fn(),
}))

import {
  processEmailWritebackJobById,
  processPendingEmailWritebackJobs,
} from "@/lib/agent/email-writeback-processor"

const LABEL_JOB = {
  id: "job-1",
  tenantId: "tenant-1",
  channelId: "channel-1",
  conversationId: "conv-1",
  action: "apply_labels",
  attempts: 0,
  providerMessageIdsJson: { threadId: "thread-1", labels: ["Needs Reply"] },
}

describe("email writeback provider dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWritebackUpdate.mockResolvedValue({})
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockAuditCreate.mockResolvedValue({})
    mockApplyFlowDeskLabelsToGmailThread.mockResolvedValue(undefined)
    mockApplyFlowDeskCategoriesToConversation.mockResolvedValue(undefined)
    mockMarkOutlookConversationRead.mockResolvedValue(undefined)
    mockCreateOutlookDraftReply.mockResolvedValue("outlook-draft-1")
    mockDeleteOutlookDraft.mockResolvedValue(undefined)
    mockDraftUpdate.mockResolvedValue({})
    mockWritebackFindUnique.mockResolvedValue(LABEL_JOB)
  })

  it("routes an apply_labels job on a microsoft channel to the Outlook adapter", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "microsoft" })

    const result = await processEmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: true })
    expect(mockApplyFlowDeskCategoriesToConversation).toHaveBeenCalledWith(
      "channel-1",
      "thread-1",
      ["Needs Reply"]
    )
    expect(mockApplyFlowDeskLabelsToGmailThread).not.toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "outlook.writeback.completed",
          payloadJson: expect.objectContaining({ result: "labels_applied" }),
        }),
      })
    )
  })

  it("routes the same job on a google channel to the Gmail adapter", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "google" })

    const result = await processEmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: true })
    expect(mockApplyFlowDeskLabelsToGmailThread).toHaveBeenCalledWith(
      "channel-1",
      "thread-1",
      ["Needs Reply"]
    )
    expect(mockApplyFlowDeskCategoriesToConversation).not.toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gmail.writeback.completed" }),
      })
    )
  })

  it("skips a job on a provider that does not support mailbox writeback", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "twilio" })

    const result = await processEmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: true })
    expect(mockApplyFlowDeskLabelsToGmailThread).not.toHaveBeenCalled()
    expect(mockApplyFlowDeskCategoriesToConversation).not.toHaveBeenCalled()
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "completed", lastError: null },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.completed",
          payloadJson: expect.objectContaining({ result: "skipped" }),
        }),
      })
    )
  })

  it("passes the raw providerMessageIds array to the Outlook mark-read call", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "microsoft" })
    mockWritebackFindUnique.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      channelId: "channel-1",
      conversationId: "conv-1",
      action: "mark_read",
      attempts: 0,
      providerMessageIdsJson: ["outlook_a", "outlook_b"],
    })

    await processEmailWritebackJobById("job-1")

    expect(mockMarkOutlookConversationRead).toHaveBeenCalledWith("channel-1", [
      "outlook_a",
      "outlook_b",
    ])
  })

  it("creates an Outlook reply draft and records the neutral providerDraftId", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "microsoft" })
    mockWritebackFindUnique.mockResolvedValue({
      id: "job-1",
      tenantId: "tenant-1",
      channelId: "channel-1",
      conversationId: "conv-1",
      action: "create_draft",
      attempts: 0,
      providerMessageIdsJson: { threadId: "thread-1" },
    })
    mockDraftFindUnique.mockResolvedValue({
      status: "proposed",
      text: "Thanks, that works for me.",
      metadataJson: {},
      conversation: {
        externalThreadId: "thread-1",
        channel: { provider: "microsoft", emailAddress: "me@example.com" },
        messages: [{ direction: "inbound" }],
      },
    })

    await processEmailWritebackJobById("job-1")

    expect(mockCreateOutlookDraftReply).toHaveBeenCalledWith("channel-1", {
      externalThreadId: "thread-1",
      body: "Thanks, that works for me.",
    })
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: { metadataJson: { providerDraftId: "outlook-draft-1" } },
    })
  })

  it("backs off then fails out an Outlook apply_labels job that keeps throwing", async () => {
    mockChannelFindUnique.mockResolvedValue({ provider: "microsoft" })
    mockApplyFlowDeskCategoriesToConversation.mockRejectedValue(new Error("graph 503"))
    mockWritebackFindMany.mockResolvedValue([LABEL_JOB])

    const first = await processPendingEmailWritebackJobs(25)

    expect(first).toEqual({ processed: 0, errors: 1 })
    // Transient retry: requeued with backoff, no audit row yet.
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        attempts: 1,
        lastError: "graph 503",
        status: "pending",
        nextAttemptAt: new Date(Date.parse("2026-07-06T00:00:00Z") + 60_000),
      },
    })
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "outlook.writeback.failed" }),
      })
    )

    // On the final attempt (attempts already 2) it fails out and audits.
    vi.clearAllMocks()
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockWritebackUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockChannelFindUnique.mockResolvedValue({ provider: "microsoft" })
    mockApplyFlowDeskCategoriesToConversation.mockRejectedValue(new Error("graph 503"))
    mockWritebackFindMany.mockResolvedValue([{ ...LABEL_JOB, attempts: 2 }])

    await processPendingEmailWritebackJobs(25)

    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { attempts: 3, lastError: "graph 503", status: "failed" },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "outlook.writeback.failed",
          payloadJson: expect.objectContaining({ result: "failed_after_retries", attempts: 3 }),
        }),
      })
    )
  })
})
