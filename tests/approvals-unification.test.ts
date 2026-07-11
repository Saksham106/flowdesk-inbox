import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockApprovalFindFirst,
  mockApprovalCreate,
  mockApprovalUpdate,
  mockApprovalUpdateMany,
  mockDraftUpdateMany,
  mockConversationFindFirst,
  mockAuditCreate,
  mockWritebackUpsert,
  mockWritebackDeleteMany,
} = vi.hoisted(() => ({
  mockApprovalFindFirst: vi.fn(),
  mockApprovalCreate: vi.fn(),
  mockApprovalUpdate: vi.fn(),
  mockApprovalUpdateMany: vi.fn(),
  mockDraftUpdateMany: vi.fn(),
  mockConversationFindFirst: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockWritebackDeleteMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    approvalRequest: {
      findFirst: mockApprovalFindFirst,
      create: mockApprovalCreate,
      update: mockApprovalUpdate,
      updateMany: mockApprovalUpdateMany,
    },
    draft: { updateMany: mockDraftUpdateMany },
    conversation: { findFirst: mockConversationFindFirst },
    auditLog: { create: mockAuditCreate },
    emailWritebackQueue: {
      upsert: mockWritebackUpsert,
      deleteMany: mockWritebackDeleteMany,
    },
  },
}))

import {
  ensureDraftApprovalRequest,
  resolveDraftApprovalRequests,
  projectDecisionOntoDraft,
} from "@/lib/agent/approvals"

const TENANT = "tenant-A"
const CONV = "conv-1"
const DRAFT = "draft-1"

beforeEach(() => {
  vi.clearAllMocks()
  mockApprovalCreate.mockResolvedValue({ id: "approval-new" })
  mockApprovalUpdateMany.mockResolvedValue({ count: 1 })
  mockDraftUpdateMany.mockResolvedValue({ count: 1 })
  mockWritebackUpsert.mockResolvedValue({ id: "job-1" })
})

describe("ensureDraftApprovalRequest", () => {
  it("creates a pending send approval when none exists", async () => {
    mockApprovalFindFirst.mockResolvedValue(null)

    await ensureDraftApprovalRequest({
      tenantId: TENANT,
      conversationId: CONV,
      draftId: DRAFT,
      source: "draft_suggest",
    })

    expect(mockApprovalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        conversationId: CONV,
        draftId: DRAFT,
        step: "send",
        metadataJson: { source: "draft_suggest" },
      }),
    })
  })

  it("is idempotent: reuses an existing pending approval", async () => {
    mockApprovalFindFirst.mockResolvedValue({ id: "approval-existing" })

    const approval = await ensureDraftApprovalRequest({
      tenantId: TENANT,
      conversationId: CONV,
      draftId: DRAFT,
      source: "draft_suggest",
    })

    expect(approval).toEqual({ id: "approval-existing" })
    expect(mockApprovalCreate).not.toHaveBeenCalled()
  })

  it("scopes the pending lookup to the tenant", async () => {
    mockApprovalFindFirst.mockResolvedValue(null)

    await ensureDraftApprovalRequest({
      tenantId: TENANT,
      conversationId: CONV,
      draftId: DRAFT,
      source: "draft_edit",
    })

    expect(mockApprovalFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId: TENANT, draftId: DRAFT, status: "pending" }),
    })
  })
})

describe("resolveDraftApprovalRequests", () => {
  it("resolves only pending requests for the tenant's draft and audits", async () => {
    const count = await resolveDraftApprovalRequests({
      tenantId: TENANT,
      draftId: DRAFT,
      resolution: "approved",
      reviewerUserId: "user-1",
      note: "sent",
    })

    expect(count).toBe(1)
    expect(mockApprovalUpdateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, draftId: DRAFT, status: "pending" },
      data: expect.objectContaining({
        status: "approved",
        reviewerUserId: "user-1",
        decisionNote: "sent",
      }),
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        action: "approval_request.resolved",
      }),
    })
  })

  it("supports cancellation and skips the audit row when nothing was pending", async () => {
    mockApprovalUpdateMany.mockResolvedValue({ count: 0 })

    const count = await resolveDraftApprovalRequests({
      tenantId: TENANT,
      draftId: DRAFT,
      resolution: "cancelled",
      note: "draft_cleared",
    })

    expect(count).toBe(0)
    expect(mockApprovalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "cancelled" }),
      })
    )
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })
})

describe("projectDecisionOntoDraft", () => {
  it("approving marks the draft approved (tenant-scoped)", async () => {
    await projectDecisionOntoDraft({
      tenantId: TENANT,
      draftId: DRAFT,
      conversationId: CONV,
      decision: "approved",
    })

    expect(mockDraftUpdateMany).toHaveBeenCalledWith({
      where: { id: DRAFT, conversation: { tenantId: TENANT } },
      data: { status: "approved" },
    })
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("rejecting clears the draft and withdraws the Gmail draft on Google channels", async () => {
    mockConversationFindFirst.mockResolvedValue({
      channelId: "channel-1",
      channel: { provider: "google" },
    })

    await projectDecisionOntoDraft({
      tenantId: TENANT,
      draftId: DRAFT,
      conversationId: CONV,
      decision: "rejected",
    })

    expect(mockDraftUpdateMany).toHaveBeenCalledWith({
      where: { id: DRAFT, conversation: { tenantId: TENANT } },
      data: { status: "none" },
    })
    expect(mockWritebackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_action: { conversationId: CONV, action: "withdraw_draft" },
        },
      })
    )
  })

  it("rejecting on a non-Google channel skips the Gmail withdrawal", async () => {
    mockConversationFindFirst.mockResolvedValue({
      channelId: "channel-2",
      channel: { provider: "microsoft" },
    })

    await projectDecisionOntoDraft({
      tenantId: TENANT,
      draftId: DRAFT,
      conversationId: CONV,
      decision: "rejected",
    })

    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })
})
