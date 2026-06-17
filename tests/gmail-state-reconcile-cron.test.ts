import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindMany,
  mockAuditCreate,
  mockWritebackUpsert,
} = vi.hoisted(() => ({
  mockConversationFindMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockWritebackUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: mockConversationFindMany },
    auditLog: { create: mockAuditCreate },
    gmailWritebackQueue: { upsert: mockWritebackUpsert },
  },
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() { return this.body }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { GET } from "@/app/api/cron/gmail-state-reconcile/route"

function request() {
  return {
    headers: new Headers({ authorization: "Bearer cron-secret" }),
  } as Request
}

describe("GET /api/cron/gmail-state-reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockConversationFindMany.mockResolvedValue([
      {
        id: "conv-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        readAt: new Date("2026-06-16T00:00:00Z"),
        gmailUnread: true,
        messages: [{ providerMessageId: "gmail_msg-1" }],
      },
    ])
    mockAuditCreate.mockResolvedValue({})
    mockWritebackUpsert.mockResolvedValue({})
  })

  it("logs Gmail read-state drift and enqueues mark-read writeback", async () => {
    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ drifted: 1, queued: 1 })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "conversation_state.drift_detected",
        payloadJson: expect.objectContaining({
          conversationId: "conv-1",
          driftType: "local_read_gmail_unread",
        }),
      }),
    })
    expect(mockWritebackUpsert).toHaveBeenCalledWith({
      where: {
        conversationId_action: {
          conversationId: "conv-1",
          action: "mark_read",
        },
      },
      create: expect.objectContaining({
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "mark_read",
        providerMessageIdsJson: ["gmail_msg-1"],
        status: "pending",
      }),
      update: expect.objectContaining({
        providerMessageIdsJson: ["gmail_msg-1"],
        status: "pending",
      }),
    })
  })
})
