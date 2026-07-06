import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindMany,
  mockWritebackUpdate,
  mockAuditCreate,
  mockApplyFlowDeskLabelsToGmailThread,
  mockMarkGmailThreadRead,
} = vi.hoisted(() => ({
  mockWritebackFindMany: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockApplyFlowDeskLabelsToGmailThread: vi.fn(),
  mockMarkGmailThreadRead: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailWritebackQueue: {
      findMany: mockWritebackFindMany,
      update: mockWritebackUpdate,
    },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
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
          labels: ["FlowDesk/Needs Reply"],
        },
      },
    ])
    mockApplyFlowDeskLabelsToGmailThread.mockResolvedValue(undefined)
    mockWritebackUpdate.mockResolvedValue({})
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
      ["FlowDesk/Needs Reply"]
    )
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        action: "gmail.labels.applied",
        payloadJson: {
          conversationId: "conv-1",
          channelId: "channel-1",
          threadId: "thread-1",
          labels: ["FlowDesk/Needs Reply"],
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

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await runGmailWriteback({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockWritebackFindMany).not.toHaveBeenCalled()
  })
})
