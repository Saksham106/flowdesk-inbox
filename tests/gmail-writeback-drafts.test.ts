import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockWritebackFindMany,
  mockWritebackUpdate,
  mockDraftFindUnique,
  mockDraftUpdate,
  mockAuditCreate,
  mockCreateGmailDraftForThread,
  mockDeleteGmailDraft,
} = vi.hoisted(() => ({
  mockWritebackFindMany: vi.fn(),
  mockWritebackUpdate: vi.fn(),
  mockDraftFindUnique: vi.fn(),
  mockDraftUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockCreateGmailDraftForThread: vi.fn(),
  mockDeleteGmailDraft: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailWritebackQueue: { findMany: mockWritebackFindMany, update: mockWritebackUpdate },
    draft: { findUnique: mockDraftFindUnique, update: mockDraftUpdate },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
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
      data: { metadataJson: { gmailDraftId: "gmail-draft-1" } },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "gmail.draft.created" }) })
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
      expect.objectContaining({ data: expect.objectContaining({ action: "gmail.draft.withdrawn" }) })
    )
  })
})
