import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindMany,
  mockWritebackUpdate,
  mockWritebackUpdateMany,
  mockChannelFindUnique,
  mockDraftFindUnique,
  mockDraftUpdate,
  mockAuditCreate,
  mockCreateGmailDraftForThread,
  mockDeleteGmailDraft,
} = vi.hoisted(() => ({
  mockWritebackFindMany: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockWritebackUpdateMany: vi.fn(),
  mockChannelFindUnique: vi.fn(),
  mockDraftFindUnique: vi.fn(),
  mockDraftUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockCreateGmailDraftForThread: vi.fn(),
  mockDeleteGmailDraft: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailWritebackQueue: {
      findMany: mockWritebackFindMany,
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
  nextWritebackAttemptDate: () => new Date(),
  createGmailDraftForThread: mockCreateGmailDraftForThread,
  deleteGmailDraft: mockDeleteGmailDraft,
  applyFlowDeskLabelsToGmailThread: vi.fn(),
  markGmailThreadRead: vi.fn(),
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
  return { headers: new Headers({ authorization: "Bearer cron-secret" }) } as Request
}

const PROPOSED_DRAFT = {
  status: "proposed",
  text: "Thanks, that works for me.",
  metadataJson: {},
  conversation: {
    externalThreadId: "thread-1",
    channel: { provider: "google", emailAddress: "me@example.com" },
    messages: [{ direction: "inbound" }],
  },
}

function createDraftJob() {
  return [
    {
      id: "job-1",
      tenantId: "tenant-1",
      channelId: "channel-1",
      conversationId: "conv-1",
      action: "create_draft",
      attempts: 0,
      providerMessageIdsJson: { threadId: "thread-1" },
    },
  ]
}

describe("Gmail writeback cron — draft jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockWritebackUpdate.mockResolvedValue({})
    mockWritebackUpdateMany.mockResolvedValue({ count: 1 })
    mockChannelFindUnique.mockResolvedValue({ provider: "google" })
    mockDraftUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockCreateGmailDraftForThread.mockResolvedValue("gmail-draft-1")
    mockDeleteGmailDraft.mockResolvedValue(undefined)
  })

  it("creates a Gmail draft, records the id, and audits", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue(PROPOSED_DRAFT)

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 1, errors: 0 })
    expect(mockCreateGmailDraftForThread).toHaveBeenCalledWith("channel-1", {
      externalThreadId: "thread-1",
      channelEmail: "me@example.com",
      body: "Thanks, that works for me.",
    })
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: { metadataJson: { providerDraftId: "gmail-draft-1" } },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.completed",
          payloadJson: expect.objectContaining({ result: "draft_created", providerDraftId: "gmail-draft-1" }),
        }),
      })
    )
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "completed", lastError: null },
    })
  })

  it("skips creation when the user has already replied manually", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      conversation: {
        ...PROPOSED_DRAFT.conversation,
        messages: [{ direction: "outbound" }],
      },
    })

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 1, errors: 0 })
    expect(mockCreateGmailDraftForThread).not.toHaveBeenCalled()
    // Job is still marked completed so it doesn't retry forever.
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "completed", lastError: null },
    })
  })

  it("deletes a previously-created Gmail draft before creating a fresh one (dedup)", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      metadataJson: { gmailDraftId: "old-draft" },
    })

    await runGmailWriteback(cronRequest())

    expect(mockDeleteGmailDraft).toHaveBeenCalledWith("channel-1", "old-draft")
    expect(mockCreateGmailDraftForThread).toHaveBeenCalled()
    // The replacement writes the neutral key and drops the stale legacy id.
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: { metadataJson: { providerDraftId: "gmail-draft-1" } },
    })
  })

  it("invalidates a FlowDesk Gmail draft when a newer meaningful inbound message arrives", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      metadataJson: {
        gmailDraftId: "old-draft",
        sourceInboundMessageId: "message-1",
        sourceInboundAt: "2026-07-10T10:00:00.000Z",
      },
      conversation: {
        ...PROPOSED_DRAFT.conversation,
        messages: [
          {
            direction: "inbound",
            providerMessageId: "message-2",
            createdAt: new Date("2026-07-10T11:00:00.000Z"),
            body: "A meaningful follow-up",
          },
          {
            direction: "inbound",
            providerMessageId: "message-1",
            createdAt: new Date("2026-07-10T10:00:00.000Z"),
            body: "Original request",
          },
        ],
      },
    })

    await runGmailWriteback(cronRequest())

    expect(mockDeleteGmailDraft).toHaveBeenCalledWith("channel-1", "old-draft")
    expect(mockCreateGmailDraftForThread).not.toHaveBeenCalled()
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: {
        metadataJson: {
          sourceInboundMessageId: "message-1",
          sourceInboundAt: "2026-07-10T10:00:00.000Z",
        },
      },
    })
  })

  it("preserves an existing FlowDesk Gmail draft when the inbound source is unchanged", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      metadataJson: {
        gmailDraftId: "current-draft",
        gmailDraftSourceInboundMessageId: "message-1",
        gmailDraftSourceInboundAt: "2026-07-10T10:00:00.000Z",
        sourceInboundMessageId: "message-1",
        sourceInboundAt: "2026-07-10T10:00:00.000Z",
      },
      conversation: {
        ...PROPOSED_DRAFT.conversation,
        messages: [
          {
            direction: "inbound",
            providerMessageId: "message-1",
            createdAt: new Date("2026-07-10T10:00:00.000Z"),
            body: "Original request",
          },
        ],
      },
    })

    await runGmailWriteback(cronRequest())

    expect(mockDeleteGmailDraft).not.toHaveBeenCalled()
    expect(mockCreateGmailDraftForThread).not.toHaveBeenCalled()
    expect(mockDraftUpdate).not.toHaveBeenCalled()
  })

  it("withdraws a FlowDesk Gmail draft when a newer manual outbound reply is synced", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      metadataJson: {
        gmailDraftId: "current-draft",
        sourceInboundMessageId: "message-1",
        sourceInboundAt: "2026-07-10T10:00:00.000Z",
      },
      conversation: {
        ...PROPOSED_DRAFT.conversation,
        messages: [
          {
            direction: "outbound",
            providerMessageId: "message-2",
            createdAt: new Date("2026-07-10T11:00:00.000Z"),
            body: "I have replied manually.",
          },
          {
            direction: "inbound",
            providerMessageId: "message-1",
            createdAt: new Date("2026-07-10T10:00:00.000Z"),
            body: "Original request",
          },
        ],
      },
    })

    await runGmailWriteback(cronRequest())

    expect(mockDeleteGmailDraft).toHaveBeenCalledWith("channel-1", "current-draft")
    expect(mockCreateGmailDraftForThread).not.toHaveBeenCalled()
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: {
        metadataJson: {
          sourceInboundMessageId: "message-1",
          sourceInboundAt: "2026-07-10T10:00:00.000Z",
        },
      },
    })
  })

  it("retries without creating a replacement when deleting the existing Gmail draft fails", async () => {
    mockWritebackFindMany.mockResolvedValue(createDraftJob())
    mockDraftFindUnique.mockResolvedValue({
      ...PROPOSED_DRAFT,
      metadataJson: { gmailDraftId: "old-draft" },
    })
    mockDeleteGmailDraft.mockRejectedValue(new Error("Gmail draft delete failed"))

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 0, errors: 1 })
    expect(mockCreateGmailDraftForThread).not.toHaveBeenCalled()
    expect(mockWritebackUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "pending",
        attempts: 1,
        lastError: "Gmail draft delete failed",
      }),
    })
  })

  it("withdraws a Gmail draft and clears its recorded id", async () => {
    mockWritebackFindMany.mockResolvedValue([
      {
        id: "job-2",
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "withdraw_draft",
        attempts: 0,
        providerMessageIdsJson: {},
      },
    ])
    mockDraftFindUnique.mockResolvedValue({ metadataJson: { gmailDraftId: "gmail-draft-1", intent: "x" } })

    const res = await runGmailWriteback(cronRequest())
    const body = await res.json()

    expect(body).toEqual({ processed: 1, errors: 0 })
    expect(mockDeleteGmailDraft).toHaveBeenCalledWith("channel-1", "gmail-draft-1")
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
      data: { metadataJson: { intent: "x" } },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmail.writeback.completed",
          payloadJson: expect.objectContaining({ result: "draft_withdrawn" }),
        }),
      })
    )
  })
})
