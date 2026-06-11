import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockStateUpsert,
  mockTaskUpsert,
  mockLeadUpsert,
  mockLeadFindFirst,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockStateUpsert: vi.fn(),
  mockTaskUpsert: vi.fn(),
  mockLeadUpsert: vi.fn(),
  mockLeadFindFirst: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst },
    conversationState: { upsert: mockStateUpsert },
    inboxTask: { upsert: mockTaskUpsert },
    lead: { upsert: mockLeadUpsert, findFirst: mockLeadFindFirst },
    auditLog: { create: mockAuditCreate },
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
    mockTaskUpsert.mockResolvedValue({ id: "task-1" })
    mockLeadUpsert.mockResolvedValue({ id: "lead-1" })
    mockLeadFindFirst.mockResolvedValue({ id: "lead-1" })
    mockAuditCreate.mockResolvedValue({})
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

    expect(result).toEqual({ stateSynced: true, tasksSynced: 1, leadSynced: true })
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
})
