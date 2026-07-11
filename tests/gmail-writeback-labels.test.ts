import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindMany,
  mockWritebackUpdate,
  mockWritebackUpdateMany,
  mockAuditCreate,
  mockApplyFlowDeskLabelsToGmailThread,
  mockMarkGmailThreadRead,
} = vi.hoisted(() => ({
  mockWritebackFindMany: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockWritebackUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockApplyFlowDeskLabelsToGmailThread: vi.fn(),
  mockMarkGmailThreadRead: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: {
      findMany: mockWritebackFindMany,
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
  markGmailThreadRead: mockMarkGmailThreadRead,
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    headers: Headers
    constructor(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body
      this.status = init?.status ?? 200
      this.headers = new Headers(init?.headers)
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { GET as runGmailWriteback } from "@/app/api/cron/gmail-writeback/route"

function cronRequest() {
  return {
    headers: new Headers({ authorization: "Bearer cron-secret" }),
  } as Request
}

describe("Gmail writeback cron label jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "apply_labels",
        attempts: 0,
        providerMessageIdsJson: {
          threadId: "thread-1",
          labels: ["Needs Reply"],
        },
      },
    ])
    mockApplyFlowDeskLabelsToGmailThread.mockResolvedValue(undefined)
    mockWritebackUpdate.mockResolvedValue({})
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockAuditCreate.mockResolvedValue({})
  })

  it("processes queued FlowDesk label writebacks and audits the Gmail mutation", async () => {
    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ processed: 1, errors: 0 })
    expect(mockApplyFlowDeskLabelsToGmailThread).toHaveBeenCalledWith(
      "channel-1",
      "thread-1",
      ["Needs Reply"]
    )
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        action: "gmail.writeback.completed",
        payloadJson: {
          writebackId: "job-1",
          action: "apply_labels",
          conversationId: "conv-1",
          channelId: "channel-1",
          result: "labels_applied",
          threadId: "thread-1",
          labels: ["Needs Reply"],
        },
      },
    })
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "completed",
        lastError: null,
      },
    })
  })

  it("claims each job atomically (pending → processing) before touching Gmail", async () => {
    await runGmailWriteback(cronRequest())

    expect(mockWritebackUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "pending" },
      data: { status: "processing" },
    })
  })

  it("skips a job another run already claimed — no double Gmail mutation", async () => {
    mockWritebackUpdateMany.mockResolvedValue({ count: 0 })

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 0, errors: 0 })
    expect(mockApplyFlowDeskLabelsToGmailThread).not.toHaveBeenCalled()
    expect(mockWritebackUpdate).not.toHaveBeenCalled()
  })

  it("requeues a failed job with exponential backoff", async () => {
    mockApplyFlowDeskLabelsToGmailThread.mockRejectedValue(new Error("rate limited"))

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ processed: 0, errors: 1 })
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        attempts: 1,
        lastError: "rate limited",
        status: "pending",
        nextAttemptAt: new Date(Date.parse("2026-07-06T00:00:00Z") + 60_000),
      },
    })
    // A transient retry is not a resolution — no audit row yet
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gmail.writeback.failed" }),
      })
    )
  })

  it("fails a job out permanently once max attempts are exhausted", async () => {
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "apply_labels",
        attempts: 2,
        providerMessageIdsJson: { threadId: "thread-1", labels: ["Needs Reply"] },
      },
    ])
    mockApplyFlowDeskLabelsToGmailThread.mockRejectedValue(new Error("still broken"))

    await runGmailWriteback(cronRequest())

    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        attempts: 3,
        lastError: "still broken",
        status: "failed",
      },
    })
    // A permanently failed job leaves a readable audit trail
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          action: "gmail.writeback.failed",
          payloadJson: expect.objectContaining({
            writebackId: "job-1",
            action: "apply_labels",
            conversationId: "conv-1",
            result: "failed_after_retries",
            error: "still broken",
            attempts: 3,
          }),
        }),
      })
    )
  })

  it("fails out unknown actions instead of leaving them queued forever", async () => {
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "mystery_action",
        attempts: 0,
        providerMessageIdsJson: {},
      },
    ])

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 0, errors: 1 })
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        lastError: "Unknown Gmail writeback action: mystery_action",
      },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.failed",
          payloadJson: expect.objectContaining({ result: "unknown_action" }),
        }),
      })
    )
  })

  it("processes an empty label set as a remove-all-FlowDesk-labels mutation", async () => {
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "apply_labels",
        attempts: 0,
        providerMessageIdsJson: { threadId: "thread-1", labels: [] },
      },
    ])

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 1, errors: 0 })
    expect(mockApplyFlowDeskLabelsToGmailThread).toHaveBeenCalledWith("channel-1", "thread-1", [])
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.completed",
          payloadJson: expect.objectContaining({ result: "labels_applied", labels: [] }),
        }),
      })
    )
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "completed", lastError: null },
    })
  })

  it("still fails invalid payloads (missing threadId or non-array labels)", async () => {
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "apply_labels",
        attempts: 0,
        providerMessageIdsJson: { labels: ["Needs Reply"] },
      },
    ])

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 0, errors: 1 })
    expect(mockApplyFlowDeskLabelsToGmailThread).not.toHaveBeenCalled()
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        lastError: "Invalid FlowDesk label writeback payload",
      },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.failed",
          payloadJson: expect.objectContaining({ result: "invalid_payload" }),
        }),
      })
    )
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await runGmailWriteback({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockWritebackFindMany).not.toHaveBeenCalled()
  })
})
