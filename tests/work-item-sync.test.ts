import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockStateUpsert,
  mockStateUpdate,
  mockStateFindUnique,
  mockTaskUpsert,
  mockLeadUpsert,
  mockLeadFindFirst,
  mockAuditCreate,
  mockKbDocFindMany,
  mockTenantFindUnique,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockStateUpsert: vi.fn(),
  mockStateUpdate: vi.fn(),
  mockStateFindUnique: vi.fn(),
  mockTaskUpsert: vi.fn(),
  mockLeadUpsert: vi.fn(),
  mockLeadFindFirst: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockKbDocFindMany: vi.fn(),
  mockTenantFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst },
    conversationState: { upsert: mockStateUpsert, update: mockStateUpdate, findUnique: mockStateFindUnique },
    inboxTask: { upsert: mockTaskUpsert },
    lead: { upsert: mockLeadUpsert, findFirst: mockLeadFindFirst },
    auditLog: { create: mockAuditCreate },
    knowledgeDocument: { findMany: mockKbDocFindMany },
    tenant: { findUnique: mockTenantFindUnique },
  },
}))

import { syncConversationWorkItems } from "@/lib/agent/work-item-sync"

const now = new Date("2026-06-11T14:00:00.000Z")

const conversation = {
  id: "conv-1",
  tenantId: "tenant-1",
  externalThreadId: "abc-dental-thread",
  label: "Lead",
  status: "needs_reply",
  lastMessageAt: now,
  contact: { name: "Sarah Patel", phoneE164: "sarah@example.com" },
  channel: { emailAddress: "owner@example.com", type: "email" },
  messages: [
    {
      id: "msg-1",
      direction: "inbound",
      body: "ABC Dental asked for pricing and a demo by Friday.",
      createdAt: now,
    },
  ],
  draft: null,
  approvalRequests: [],
  calendarHolds: [],
}

describe("syncConversationWorkItems", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationFindFirst.mockResolvedValue(conversation)
    mockStateUpsert.mockResolvedValue({ id: "state-1" })
    mockStateUpdate.mockResolvedValue({ id: "state-1" })
    mockStateFindUnique.mockResolvedValue(null)
    mockTaskUpsert.mockResolvedValue({ id: "task-1" })
    mockLeadUpsert.mockResolvedValue({ id: "lead-1" })
    mockLeadFindFirst.mockResolvedValue({ id: "lead-1" })
    mockAuditCreate.mockResolvedValue({})
    mockKbDocFindMany.mockResolvedValue([])
    mockTenantFindUnique.mockResolvedValue({ accountType: "business" })
  })

  it("loads the conversation scoped to the tenant", async () => {
    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockConversationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", tenantId: "tenant-1" },
      })
    )
  })

  it("upserts conversation state, task, and lead records", async () => {
    const result = await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(result).toEqual({ stateSynced: true, tasksSynced: 1, leadSynced: true, supportClassified: false, salesClassified: true })
    expect(mockStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1" },
        create: expect.objectContaining({ tenantId: "tenant-1", conversationId: "conv-1" }),
        update: expect.objectContaining({ state: "opportunity" }),
      })
    )
    expect(mockTaskUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_deterministicKey: { tenantId: "tenant-1", deterministicKey: "conv-1:msg-1:deadline" } },
      })
    )
    expect(mockLeadUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_conversationId: { tenantId: "tenant-1", conversationId: "conv-1" } },
      })
    )
  })

  it("does not overwrite an existing lead score during deterministic sync", async () => {
    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockLeadUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ score: expect.any(Number) }),
        update: expect.not.objectContaining({ score: expect.any(Number) }),
      })
    )
  })

  it("does not create lead records for personal accounts", async () => {
    mockTenantFindUnique.mockResolvedValue({ accountType: "personal" })

    const result = await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(result.leadSynced).toBe(false)
    expect(result.salesClassified).toBe(false)
    expect(mockLeadUpsert).not.toHaveBeenCalled()
    expect(mockLeadFindFirst).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "lead.synced" }),
      })
    )
  })

  it("writes audit logs for synced records", async () => {
    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-1", action: "conversation_state.synced" }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-1", action: "inbox_task.synced" }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: "tenant-1", action: "lead.synced" }),
      })
    )
  })

  it("throws when the conversation does not belong to the tenant", async () => {
    mockConversationFindFirst.mockResolvedValue(null)

    await expect(
      syncConversationWorkItems({
        tenantId: "tenant-1",
        conversationId: "conv-other",
        now,
      })
    ).rejects.toThrow("Conversation not found")

    expect(mockStateUpsert).not.toHaveBeenCalled()
    expect(mockTaskUpsert).not.toHaveBeenCalled()
    expect(mockLeadUpsert).not.toHaveBeenCalled()
  })

  it("preserves existing metadata keys when merging sales fields (metadata merge path)", async () => {
    // Seed the state row with a pre-existing key that is not written by either
    // the support or sales classifier (customTag).  The key must survive
    // through both classification spreads into the final sales update.
    mockStateFindUnique.mockResolvedValue({
      metadataJson: { isSupport: true, customTag: "vip" },
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    // The sales update (the last mockStateUpdate call) must contain both the
    // pre-existing customTag key and the new sales-specific keys.
    const allUpdateCalls = mockStateUpdate.mock.calls
    const salesUpdateCall = allUpdateCalls[allUpdateCalls.length - 1]
    const metadataJson = salesUpdateCall[0].data.metadataJson

    expect(metadataJson).toMatchObject({
      customTag: "vip",
      isSalesLead: true,
      closingStage: "prospect",
    })
  })

  it("does not call the sales state update for a non-sales conversation", async () => {
    const nonSalesConversation = {
      ...conversation,
      messages: [
        {
          id: "msg-2",
          direction: "inbound",
          body: "Hi there, just following up on the project.",
          createdAt: now,
        },
      ],
    }
    mockConversationFindFirst.mockResolvedValue(nonSalesConversation)

    const result = await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(result.salesClassified).toBe(false)
    // mockStateUpdate may be called for the support path, but must never be
    // called with isSalesLead in its payload.
    const updateCallsWithSales = mockStateUpdate.mock.calls.filter(
      (call) => call[0]?.data?.metadataJson?.isSalesLead === true
    )
    expect(updateCallsWithSales).toHaveLength(0)
  })
})
