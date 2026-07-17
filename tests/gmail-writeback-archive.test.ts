import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindUnique,
  mockWritebackUpdate,
  mockWritebackUpdateMany,
  mockChannelFindUnique,
  mockAuditCreate,
  mockArchiveGmailThread,
} = vi.hoisted(() => ({
  mockWritebackFindUnique: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockWritebackUpdateMany: vi.fn(),
  mockChannelFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockArchiveGmailThread: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: {
      findUnique: mockWritebackFindUnique,
      update: mockWritebackUpdate,
      updateMany: mockWritebackUpdateMany,
    },
    channel: { findUnique: mockChannelFindUnique },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
  GMAIL_WRITEBACK_MAX_ATTEMPTS: 3,
  nextWritebackAttemptDate: (attempts: number) =>
    new Date(Date.parse("2026-07-17T00:00:00Z") + attempts * 60_000),
  archiveGmailThread: mockArchiveGmailThread,
}))

const { processEmailWritebackJobById } = await import("@/lib/agent/email-writeback-processor")
const { ARCHIVE_THREAD_ACTION } = await import("@/lib/agent/auto-triage")

function archiveJob(payload: unknown = { threadId: "thread-1" }) {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    channelId: "channel-1",
    conversationId: "conv-1",
    action: ARCHIVE_THREAD_ACTION,
    attempts: 0,
    providerMessageIdsJson: payload,
  }
}

describe("email writeback archive_thread jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockWritebackUpdate.mockResolvedValue({})
    mockChannelFindUnique.mockResolvedValue({ provider: "google" })
    mockAuditCreate.mockResolvedValue({})
    mockArchiveGmailThread.mockResolvedValue(undefined)
  })

  it("archives the thread in the mailbox and completes the job", async () => {
    mockWritebackFindUnique.mockResolvedValue(archiveJob())

    const { ok } = await processEmailWritebackJobById("job-1")

    expect(ok).toBe(true)
    expect(mockArchiveGmailThread).toHaveBeenCalledWith("channel-1", "thread-1")
    expect(mockWritebackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.completed",
          payloadJson: expect.objectContaining({ result: "archived", threadId: "thread-1" }),
        }),
      })
    )
  })

  it("fails out a payload without a threadId instead of retrying forever", async () => {
    mockWritebackFindUnique.mockResolvedValue(archiveJob({}))

    const { ok } = await processEmailWritebackJobById("job-1")

    expect(ok).toBe(false)
    expect(mockArchiveGmailThread).not.toHaveBeenCalled()
    expect(mockWritebackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    )
  })

  it("leaves the job pending for retry when the mailbox call fails", async () => {
    mockWritebackFindUnique.mockResolvedValue(archiveJob())
    mockArchiveGmailThread.mockRejectedValue(new Error("gmail unavailable"))

    const { ok } = await processEmailWritebackJobById("job-1")

    expect(ok).toBe(false)
    expect(mockWritebackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending", lastError: "gmail unavailable" }),
      })
    )
  })
})
