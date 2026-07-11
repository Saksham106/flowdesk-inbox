import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindUnique,
  mockWritebackUpdate,
  mockWritebackUpdateMany,
  mockAuditCreate,
  mockApplyFlowDeskLabelsToGmailThread,
} = vi.hoisted(() => ({
  mockWritebackFindUnique: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockWritebackUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockApplyFlowDeskLabelsToGmailThread: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: {
      findUnique: mockWritebackFindUnique,
      update: mockWritebackUpdate,
      updateMany: mockWritebackUpdateMany,
    },
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
}))

import { processGmailWritebackJobById } from "@/lib/agent/gmail-writeback-processor"

const JOB = {
  id: "job-1",
  tenantId: "tenant-1",
  channelId: "channel-1",
  conversationId: "conv-1",
  action: "apply_labels",
  attempts: 0,
  providerMessageIdsJson: { threadId: "thread-1", labels: ["Needs Reply"] },
}

describe("processGmailWritebackJobById (inline drain)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockWritebackFindUnique.mockResolvedValue(JOB)
    mockApplyFlowDeskLabelsToGmailThread.mockResolvedValue(undefined)
    mockWritebackUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it("claims a pending job, applies it to Gmail, and marks it completed", async () => {
    const result = await processGmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: true })
    expect(mockWritebackUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "pending" },
      data: { status: "processing" },
    })
    expect(mockApplyFlowDeskLabelsToGmailThread).toHaveBeenCalledWith(
      "channel-1",
      "thread-1",
      ["Needs Reply"]
    )
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "completed", lastError: null },
    })
  })

  it("no-ops without touching Gmail when the job was already claimed by the cron", async () => {
    mockWritebackUpdateMany.mockResolvedValue({ count: 0 })

    const result = await processGmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: false })
    expect(mockApplyFlowDeskLabelsToGmailThread).not.toHaveBeenCalled()
  })

  it("leaves the job pending for the cron backstop when the inline attempt fails", async () => {
    mockApplyFlowDeskLabelsToGmailThread.mockRejectedValue(new Error("rate limited"))

    const result = await processGmailWritebackJobById("job-1")

    expect(result).toEqual({ ok: false })
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        attempts: 1,
        lastError: "rate limited",
        status: "pending",
        nextAttemptAt: new Date(Date.parse("2026-07-06T00:00:00Z") + 60_000),
      },
    })
  })
})
