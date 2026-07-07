import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockDraftUpdateMany,
  mockRevalidateInboxViews,
  mockWritebackUpsert,
  mockWritebackDeleteMany,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockDraftUpdateMany: vi.fn(),
  mockRevalidateInboxViews: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockWritebackDeleteMany: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: mockConversationFindFirst,
      update: mockConversationUpdate,
    },
    draft: {
      updateMany: mockDraftUpdateMany,
    },
    gmailWritebackQueue: {
      upsert: mockWritebackUpsert,
      deleteMany: mockWritebackDeleteMany,
    },
    auditLog: {
      create: mockAuditCreate,
    },
  },
}))

let mockSession: unknown = null
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/cache-tags", () => ({
  revalidateInboxViews: mockRevalidateInboxViews,
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { PATCH as updateWorkflowStatus } from "@/app/api/conversations/[id]/workflow-status/route"

function makeReq(body: Record<string, unknown> = {}): { json: () => Promise<unknown> } {
  return { json: async () => body }
}

describe("PATCH /api/conversations/[id]/workflow-status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { id: "user1", tenantId: "tenant-A" } }
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      externalThreadId: "thread-1",
      label: null,
      draft: { status: "proposed" },
      stateRecord: { attentionCategory: null },
      channel: { provider: "google" },
    })
    mockConversationUpdate.mockResolvedValue({ id: "conv1" })
    mockDraftUpdateMany.mockResolvedValue({ count: 1 })
    mockWritebackUpsert.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it("clears unsent drafts when a manual Done action leaves draft review", async () => {
    const res = await updateWorkflowStatus(makeReq({ workflowStatus: "done" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv1", tenantId: "tenant-A" },
      data: expect.objectContaining({
        status: "closed",
        userState: "done",
      }),
    })
    expect(mockDraftUpdateMany).toHaveBeenCalledWith({
      where: {
        conversationId: "conv1",
        status: { in: ["proposed", "approved"] },
        conversation: { tenantId: "tenant-A" },
      },
      data: {
        status: "none",
        text: "",
      },
    })
    expect(mockRevalidateInboxViews).toHaveBeenCalledWith("tenant-A", "conv1")
    expect(mockWritebackUpsert).toHaveBeenCalledWith({
      where: {
        conversationId_action: {
          conversationId: "conv1",
          action: "apply_labels",
        },
      },
      create: expect.objectContaining({
        tenantId: "tenant-A",
        channelId: "channel-1",
        conversationId: "conv1",
        action: "apply_labels",
        providerMessageIdsJson: expect.objectContaining({
          threadId: "thread-1",
          labels: ["Handled"],
        }),
      }),
      update: expect.objectContaining({
        providerMessageIdsJson: expect.objectContaining({
          threadId: "thread-1",
          labels: ["Handled"],
        }),
      }),
    })
  })

  it("clears unsent drafts when Waiting On is selected after sending", async () => {
    const res = await updateWorkflowStatus(makeReq({ workflowStatus: "waiting_on" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockDraftUpdateMany).toHaveBeenCalledOnce()
    expect(mockConversationUpdate.mock.calls[0][0].data).toMatchObject({
      status: "in_progress",
      userState: "waiting_on",
    })
    expect(mockWritebackUpsert.mock.calls[0][0].create.providerMessageIdsJson.labels).toEqual([
      "Waiting On",
    ])
  })

  it("does not clear drafts when a conversation is explicitly reset to Needs Reply", async () => {
    const res = await updateWorkflowStatus(makeReq({ workflowStatus: "needs_reply" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockConversationUpdate.mock.calls[0][0].data).toMatchObject({
      status: "needs_reply",
      userState: null,
    })
    expect(mockDraftUpdateMany).not.toHaveBeenCalled()
  })
})
