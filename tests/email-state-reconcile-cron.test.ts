import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindMany,
  mockConversationUpdate,
  mockMessageUpdateMany,
  mockAuditCreate,
  mockWritebackUpsert,
} = vi.hoisted(() => ({
  mockConversationFindMany: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockMessageUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockWritebackUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: mockConversationFindMany, update: mockConversationUpdate },
    message: { updateMany: mockMessageUpdateMany },
    auditLog: { create: mockAuditCreate },
    emailWritebackQueue: { upsert: mockWritebackUpsert },
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

describe("GET /api/cron/gmail-state-reconcile (email-state-reconcile cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockConversationFindMany.mockResolvedValue([
      {
        id: "conv-1",
        tenantId: "tenant-1",
        channelId: "channel-1",
        userStateSource: "user",
        readAt: new Date("2026-06-16T00:00:00Z"),
        gmailUnread: true,
        channel: { provider: "google" },
        messages: [{ providerMessageId: "gmail_msg-1" }],
      },
    ])
    mockAuditCreate.mockResolvedValue({})
    mockWritebackUpsert.mockResolvedValue({})
    mockConversationUpdate.mockResolvedValue({})
    mockMessageUpdateMany.mockResolvedValue({})
  })

  it("protects explicit user reads by logging Gmail drift and enqueueing mark-read writeback", async () => {
    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ drifted: 1, queued: 1, reconciled: 0 })
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
    expect(mockConversationUpdate).not.toHaveBeenCalled()
    expect(mockMessageUpdateMany).not.toHaveBeenCalled()
  })

  it("auto-reconciles non-user local reads back to Gmail unread state", async () => {
    mockConversationFindMany.mockResolvedValueOnce([
      {
        id: "conv-2",
        tenantId: "tenant-1",
        channelId: "channel-1",
        userStateSource: "ai",
        readAt: new Date("2026-06-16T00:00:00Z"),
        gmailUnread: true,
        channel: { provider: "google" },
        messages: [{ providerMessageId: "gmail_msg-2" }],
      },
    ])

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ drifted: 1, queued: 0, reconciled: 1 })
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-2" },
      data: {
        readAt: null,
        userStateSource: "gmail_reconcile",
        userStateUpdatedAt: expect.any(Date),
      },
    })
    expect(mockMessageUpdateMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-2" },
      data: { isRead: false },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "conversation_state.auto_reconciled",
        payloadJson: expect.objectContaining({
          conversationId: "conv-2",
          source: "ai",
        }),
      }),
    })
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("queues mark_read for a user-read microsoft conversation drifted from provider unread, tagged with the provider driftType", async () => {
    mockConversationFindMany.mockResolvedValueOnce([
      {
        id: "conv-3",
        tenantId: "tenant-1",
        channelId: "channel-2",
        userStateSource: "user",
        readAt: new Date("2026-06-16T00:00:00Z"),
        gmailUnread: true,
        channel: { provider: "microsoft" },
        messages: [{ providerMessageId: "outlook_msg-1" }],
      },
    ])

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ drifted: 1, queued: 1, reconciled: 0 })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "conversation_state.drift_detected",
        payloadJson: expect.objectContaining({
          conversationId: "conv-3",
          driftType: "local_read_provider_unread",
        }),
      }),
    })
    expect(mockWritebackUpsert).toHaveBeenCalledWith({
      where: {
        conversationId_action: {
          conversationId: "conv-3",
          action: "mark_read",
        },
      },
      create: expect.objectContaining({
        tenantId: "tenant-1",
        channelId: "channel-2",
        conversationId: "conv-3",
        action: "mark_read",
        providerMessageIdsJson: ["outlook_msg-1"],
        status: "pending",
      }),
      update: expect.objectContaining({
        providerMessageIdsJson: ["outlook_msg-1"],
        status: "pending",
      }),
    })
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET

    const res = await GET({
      headers: new Headers({ authorization: "Bearer undefined" }),
    } as Request)

    expect(res.status).toBe(401)
    expect(mockConversationFindMany).not.toHaveBeenCalled()
  })
})
