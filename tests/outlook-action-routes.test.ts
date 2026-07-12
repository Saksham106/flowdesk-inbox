import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockConversationStateFindUnique,
  mockConversationStateUpsert,
  mockMessageUpdateMany,
  mockMessageFindMany,
  mockDraftUpdateMany,
  mockRevalidateInboxViews,
  mockWritebackUpsert,
  mockWritebackDeleteMany,
  mockAuditCreate,
  // Gmail (google) mailbox fns
  mockArchiveGmailThread,
  mockTrashGmailThread,
  mockMarkGmailThreadRead,
  // Outlook (microsoft) mailbox fns
  mockArchiveOutlookConversation,
  mockTrashOutlookConversation,
  mockMarkOutlookConversationRead,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockConversationStateFindUnique: vi.fn(),
  mockConversationStateUpsert: vi.fn(),
  mockMessageUpdateMany: vi.fn(),
  mockMessageFindMany: vi.fn(),
  mockDraftUpdateMany: vi.fn(),
  mockRevalidateInboxViews: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockWritebackDeleteMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockArchiveGmailThread: vi.fn(),
  mockTrashGmailThread: vi.fn(),
  mockMarkGmailThreadRead: vi.fn(),
  mockArchiveOutlookConversation: vi.fn(),
  mockTrashOutlookConversation: vi.fn(),
  mockMarkOutlookConversationRead: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: mockConversationFindFirst,
      update: mockConversationUpdate,
    },
    conversationState: {
      findUnique: mockConversationStateFindUnique,
      upsert: mockConversationStateUpsert,
    },
    message: {
      updateMany: mockMessageUpdateMany,
      findMany: mockMessageFindMany,
    },
    draft: {
      updateMany: mockDraftUpdateMany,
    },
    emailWritebackQueue: {
      findUnique: vi.fn().mockResolvedValue(null),
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

// The inline writeback drain (lib/agent/email-writeback-processor.ts) is a
// separate concern from these routes' own logic — stub it out so tests aren't
// exercising real Gmail/Outlook-API-adjacent code (see workflow-status-route.test.ts).
vi.mock("@/lib/agent/email-writeback-processor", () => ({
  processEmailWritebackJobById: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock("@/lib/agent/conversation-state-metadata", () => ({
  conversationStateMetadataData: () => ({}),
}))

vi.mock("@/lib/google", () => ({
  archiveGmailThread: mockArchiveGmailThread,
  trashGmailThread: mockTrashGmailThread,
  markGmailThreadRead: mockMarkGmailThreadRead,
  unarchiveGmailThread: vi.fn(),
  createGmailDraftForThread: vi.fn(),
  deleteGmailDraft: vi.fn(),
  ensureFlowDeskLabels: vi.fn(),
  applyFlowDeskLabelsToGmailThread: vi.fn(),
}))

vi.mock("@/lib/outlook-mailbox", () => ({
  archiveOutlookConversation: mockArchiveOutlookConversation,
  trashOutlookConversation: mockTrashOutlookConversation,
  markOutlookConversationRead: mockMarkOutlookConversationRead,
  restoreOutlookConversation: vi.fn(),
  createOutlookDraftReply: vi.fn(),
  deleteOutlookDraft: vi.fn(),
  ensureFlowDeskCategories: vi.fn(),
  applyFlowDeskCategoriesToConversation: vi.fn(),
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

import { PATCH as archiveConversation } from "@/app/api/conversations/[id]/archive/route"
import { PATCH as trashConversation } from "@/app/api/conversations/[id]/trash/route"
import { PATCH as toggleRead } from "@/app/api/conversations/[id]/read/route"
import { PATCH as updateStatus } from "@/app/api/conversations/[id]/status/route"
import { PATCH as updateWorkflowStatus } from "@/app/api/conversations/[id]/workflow-status/route"
import { projectDecisionOntoDraft } from "@/lib/agent/approvals"

function makeReq(body: Record<string, unknown> = {}): { json: () => Promise<unknown> } {
  return { json: async () => body }
}

const MICROSOFT_CONVERSATION = {
  id: "conv1",
  channelId: "channel-1",
  externalThreadId: "outlook-thread-1",
  channel: { provider: "microsoft" },
}

const TWILIO_CONVERSATION = {
  id: "conv1",
  channelId: "channel-1",
  externalThreadId: "sms-thread-1",
  channel: { provider: "twilio" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession = { user: { id: "user1", tenantId: "tenant-A" } }
  mockConversationStateFindUnique.mockResolvedValue(null)
  mockConversationStateUpsert.mockResolvedValue({})
  mockConversationUpdate.mockResolvedValue({})
  mockMessageUpdateMany.mockResolvedValue({ count: 0 })
  mockRevalidateInboxViews.mockReturnValue(undefined)
  mockWritebackUpsert.mockResolvedValue({ id: "job-1" })
  mockWritebackDeleteMany.mockResolvedValue({ count: 0 })
  mockAuditCreate.mockResolvedValue({})
})

describe("PATCH /api/conversations/[id]/archive", () => {
  it("archives a microsoft conversation via the Outlook adapter", async () => {
    mockConversationFindFirst.mockResolvedValue(MICROSOFT_CONVERSATION)
    mockArchiveOutlookConversation.mockResolvedValue(undefined)

    const res = await archiveConversation({} as never, { params: { id: "conv1" } })

    expect(res.status).toBe(200)
    expect(mockArchiveOutlookConversation).toHaveBeenCalledWith("channel-1", "outlook-thread-1")
    expect(mockArchiveGmailThread).not.toHaveBeenCalled()
  })

  it("rejects archive on a twilio/sms conversation with a clean 400", async () => {
    mockConversationFindFirst.mockResolvedValue(TWILIO_CONVERSATION)

    const res = await archiveConversation({} as never, { params: { id: "conv1" } })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Archive is not supported for this channel" })
    expect(mockArchiveOutlookConversation).not.toHaveBeenCalled()
    expect(mockArchiveGmailThread).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/conversations/[id]/trash", () => {
  it("moves a microsoft conversation to deleteditems via the Outlook adapter", async () => {
    mockConversationFindFirst.mockResolvedValue(MICROSOFT_CONVERSATION)
    mockTrashOutlookConversation.mockResolvedValue(undefined)

    const res = await trashConversation({} as never, { params: { id: "conv1" } })

    expect(res.status).toBe(200)
    expect(mockTrashOutlookConversation).toHaveBeenCalledWith("channel-1", "outlook-thread-1")
    expect(mockTrashGmailThread).not.toHaveBeenCalled()
  })

  it("rejects trash on a twilio/sms conversation with a clean 400", async () => {
    mockConversationFindFirst.mockResolvedValue(TWILIO_CONVERSATION)

    const res = await trashConversation({} as never, { params: { id: "conv1" } })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Trash is not supported for this channel" })
    expect(mockTrashOutlookConversation).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/conversations/[id]/read", () => {
  it("marks a microsoft conversation read via the Outlook adapter", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      channel: { provider: "microsoft" },
      messages: [{ providerMessageId: "outlook_a" }, { providerMessageId: "outlook_b" }],
    })
    mockMarkOutlookConversationRead.mockResolvedValue(undefined)

    const res = await toggleRead(makeReq({ read: true }) as never, { params: { id: "conv1" } })

    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(mockMarkOutlookConversationRead).toHaveBeenCalledWith("channel-1", [
      "outlook_a",
      "outlook_b",
    ])
    expect(mockMarkGmailThreadRead).not.toHaveBeenCalled()
  })

  it("does not attempt a mailbox writeback for a twilio/sms conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      channel: { provider: "twilio" },
      messages: [],
    })

    const res = await toggleRead(makeReq({ read: true }) as never, { params: { id: "conv1" } })

    expect(res.status).toBe(200)
    expect(mockMarkOutlookConversationRead).not.toHaveBeenCalled()
    expect(mockMarkGmailThreadRead).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/conversations/[id]/status", () => {
  beforeEach(() => {
    mockMessageFindMany.mockResolvedValue([{ providerMessageId: "outlook_a" }])
  })

  it("marks read via the Outlook adapter and queues a label writeback for a microsoft conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      externalThreadId: "outlook-thread-1",
      channel: { provider: "microsoft" },
      draft: { status: null },
    })
    mockMarkOutlookConversationRead.mockResolvedValue(undefined)

    const res = await updateStatus(makeReq({ status: "closed" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(mockMarkOutlookConversationRead).toHaveBeenCalledWith("channel-1", ["outlook_a"])
    expect(mockMarkGmailThreadRead).not.toHaveBeenCalled()
    expect(mockWritebackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ channelId: "channel-1", action: "apply_labels" }),
      })
    )
  })

  it("updates status but skips any mailbox writeback for a twilio/sms conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      externalThreadId: "sms-thread-1",
      channel: { provider: "twilio" },
      draft: { status: null },
    })

    const res = await updateStatus(makeReq({ status: "closed" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockMarkOutlookConversationRead).not.toHaveBeenCalled()
    expect(mockMarkGmailThreadRead).not.toHaveBeenCalled()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/conversations/[id]/workflow-status", () => {
  it("queues a label writeback for a microsoft conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      externalThreadId: "outlook-thread-1",
      label: null,
      draft: { status: "proposed" },
      stateRecord: { attentionCategory: null, emailType: null },
      channel: { provider: "microsoft" },
    })
    mockDraftUpdateMany.mockResolvedValue({ count: 1 })

    const res = await updateWorkflowStatus(makeReq({ workflowStatus: "done" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockWritebackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ channelId: "channel-1", action: "apply_labels" }),
      })
    )
    // done clears the draft, which withdraws the provider-native draft too.
    expect(mockWritebackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ action: "withdraw_draft" }),
      })
    )
  })

  it("skips the label/draft-withdrawal writeback for a twilio/sms conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      id: "conv1",
      channelId: "channel-1",
      externalThreadId: "sms-thread-1",
      label: null,
      draft: { status: "proposed" },
      stateRecord: { attentionCategory: null, emailType: null },
      channel: { provider: "twilio" },
    })
    mockDraftUpdateMany.mockResolvedValue({ count: 1 })

    const res = await updateWorkflowStatus(makeReq({ workflowStatus: "done" }) as never, {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })
})

describe("projectDecisionOntoDraft (lib/agent/approvals) rejection withdrawal", () => {
  it("withdraws the provider-native draft for a microsoft conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      channelId: "channel-1",
      channel: { provider: "microsoft" },
    })

    await projectDecisionOntoDraft({
      tenantId: "tenant-A",
      draftId: "draft-1",
      conversationId: "conv1",
      decision: "rejected",
    })

    expect(mockWritebackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ channelId: "channel-1", action: "withdraw_draft" }),
      })
    )
  })

  it("does not attempt withdrawal for a twilio/sms conversation", async () => {
    mockConversationFindFirst.mockResolvedValue({
      channelId: "channel-1",
      channel: { provider: "twilio" },
    })

    await projectDecisionOntoDraft({
      tenantId: "tenant-A",
      draftId: "draft-1",
      conversationId: "conv1",
      decision: "rejected",
    })

    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })
})
