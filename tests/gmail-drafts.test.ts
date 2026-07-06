import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockDeleteMany, mockUpsert, mockAuditCreate, mockAutopilotSettingFindUnique } = vi.hoisted(() => ({
  mockDeleteMany: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAutopilotSettingFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailWritebackQueue: { deleteMany: mockDeleteMany, upsert: mockUpsert },
    auditLog: { create: mockAuditCreate },
    autopilotSetting: { findUnique: mockAutopilotSettingFindUnique },
  },
}))

import {
  GMAIL_DRAFT_CREATE_ACTION,
  GMAIL_DRAFT_WITHDRAW_ACTION,
  gmailDraftIdFromMetadata,
  queueGmailDraftWithdrawal,
  queueGmailDraftWriteback,
} from "@/lib/gmail-drafts"

describe("gmailDraftIdFromMetadata", () => {
  it("returns the stored id when present", () => {
    expect(gmailDraftIdFromMetadata({ gmailDraftId: "draft-123" })).toBe("draft-123")
  })
  it("returns null for missing/invalid metadata", () => {
    expect(gmailDraftIdFromMetadata(null)).toBeNull()
    expect(gmailDraftIdFromMetadata({})).toBeNull()
    expect(gmailDraftIdFromMetadata([1, 2])).toBeNull()
    expect(gmailDraftIdFromMetadata({ gmailDraftId: "" })).toBeNull()
  })
})

describe("queueGmailDraftWriteback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsert.mockResolvedValue({ id: "job-1" })
    mockDeleteMany.mockResolvedValue({ count: 0 })
    mockAuditCreate.mockResolvedValue({})
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 3, enabled: false })
  })

  it("no-ops below automation Level 3 (draft stays dashboard-only)", async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 2, enabled: false })

    const job = await queueGmailDraftWriteback({
      tenantId: "t1",
      channelId: "c1",
      conversationId: "conv-1",
      threadId: "thread-1",
    })

    expect(job).toBeNull()
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it("drops any pending withdrawal, upserts a create_draft job, and audits", async () => {
    await queueGmailDraftWriteback({
      tenantId: "t1",
      channelId: "c1",
      conversationId: "conv-1",
      threadId: "thread-1",
    })

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", action: GMAIL_DRAFT_WITHDRAW_ACTION },
    })
    const upsertArg = mockUpsert.mock.calls[0][0]
    expect(upsertArg.where.conversationId_action).toEqual({
      conversationId: "conv-1",
      action: GMAIL_DRAFT_CREATE_ACTION,
    })
    expect(upsertArg.create.providerMessageIdsJson).toEqual({ threadId: "thread-1" })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "gmail.draft.queued" }) })
    )
  })
})

describe("queueGmailDraftWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsert.mockResolvedValue({ id: "job-2" })
    mockDeleteMany.mockResolvedValue({ count: 0 })
    mockAuditCreate.mockResolvedValue({})
    // Withdrawal must work at any level — cleanup is never level-gated.
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 0, enabled: false })
  })

  it("drops any pending create, upserts a withdraw_draft job, and audits", async () => {
    await queueGmailDraftWithdrawal({
      tenantId: "t1",
      channelId: "c1",
      conversationId: "conv-1",
    })

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", action: GMAIL_DRAFT_CREATE_ACTION },
    })
    const upsertArg = mockUpsert.mock.calls[0][0]
    expect(upsertArg.where.conversationId_action).toEqual({
      conversationId: "conv-1",
      action: GMAIL_DRAFT_WITHDRAW_ACTION,
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gmail.draft.withdraw_queued" }),
      })
    )
  })
})
