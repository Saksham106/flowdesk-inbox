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
  mockConversationUpdate,
  mockSyncPersonMemoryWithLLM,
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
  mockConversationUpdate: vi.fn(),
  mockSyncPersonMemoryWithLLM: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst, update: mockConversationUpdate },
    conversationState: { upsert: mockStateUpsert, update: mockStateUpdate, findUnique: mockStateFindUnique },
    inboxTask: { upsert: mockTaskUpsert },
    lead: { upsert: mockLeadUpsert, findFirst: mockLeadFindFirst },
    auditLog: { create: mockAuditCreate },
    knowledgeDocument: { findMany: mockKbDocFindMany },
    tenant: { findUnique: mockTenantFindUnique },
  },
}))

vi.mock("@/lib/agent/person-memory", () => ({
  syncPersonMemoryWithLLM: mockSyncPersonMemoryWithLLM,
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
  contactId: "contact-1",
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
    mockConversationUpdate.mockResolvedValue({})
    mockSyncPersonMemoryWithLLM.mockResolvedValue({ status: "llm_completed" })
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

    // The sales update must contain both the pre-existing customTag key and
    // the new sales-specific keys, even if later metadata updates run.
    const allUpdateCalls = mockStateUpdate.mock.calls
    const salesUpdateCall = allUpdateCalls.find(
      (call) => call[0]?.data?.metadataJson?.isSalesLead === true
    )
    const metadataJson = salesUpdateCall?.[0].data.metadataJson

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

  it("does not overwrite a user override state during deterministic sync", async () => {
    mockStateFindUnique.mockResolvedValue({
      source: "user_override",
      metadataJson: { userOverride: true, userState: "done" },
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockStateUpsert).not.toHaveBeenCalled()
    expect(mockStateUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: expect.any(String) }),
      })
    )
  })

  it("persists detectedCode in action metadata when the email contains an OTP", async () => {
    mockTenantFindUnique.mockResolvedValue({ accountType: "personal" })
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      messages: [
        {
          id: "msg-otp",
          direction: "inbound",
          body: "Your verification code is 847291. This code expires in 10 minutes.",
          createdAt: now,
        },
      ],
    })
    mockStateFindUnique.mockResolvedValue(null)

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    const updateCall = mockStateUpdate.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        (c[0] as Record<string, unknown>)?.data !== undefined &&
        ((c[0] as Record<string, { metadataJson?: { action?: { type?: string } } }>).data?.metadataJson?.action?.type) === "otp_code"
    )
    expect(updateCall).toBeDefined()
    const action = (updateCall![0] as Record<string, { metadataJson: { action: Record<string, unknown> } }>).data.metadataJson.action
    expect(action.hasDetectedCode).toBe(true)
    expect(action.detectedCode).toBe("847291")
  })

  it("skips relationship-memory LLM for OTP emails", async () => {
    mockTenantFindUnique.mockResolvedValue({ accountType: "personal" })
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      label: null,
      messages: [
        {
          id: "msg-otp",
          direction: "inbound",
          body: "Your verification code is 847291. This code expires in 10 minutes.",
          fromE164: "noreply@app.com",
          createdAt: now,
        },
      ],
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockSyncPersonMemoryWithLLM).not.toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ai.person_memory.skipped",
          payloadJson: expect.objectContaining({ reason: expect.stringMatching(/transactional/i) }),
        }),
      })
    )
  })

  it("skips relationship-memory LLM for LinkedIn job alerts", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      label: null,
      messages: [
        {
          id: "msg-linkedin",
          direction: "inbound",
          body: "Your LinkedIn job alert has 12 new jobs for software engineer.",
          fromE164: "jobs-noreply@linkedin.com",
          createdAt: now,
        },
      ],
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockSyncPersonMemoryWithLLM).not.toHaveBeenCalled()
  })

  it("runs relationship-memory LLM for real human reply threads with a contact", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      label: null,
      messages: [
        {
          id: "msg-human",
          direction: "inbound",
          body: "Could you reply with the final address for tomorrow's meeting?",
          fromE164: "alice@example.com",
          createdAt: now,
        },
      ],
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    expect(mockSyncPersonMemoryWithLLM).toHaveBeenCalledWith(
      "tenant-1",
      "contact-1",
      expect.objectContaining({ featureContext: "work_item_sync" })
    )
  })

  it("preserves user-corrected attentionCategory when the email classifier runs", async () => {
    // The email classifier would normally classify an OTP as "needs_action", but the
    // user has already manually set attention to "read_later" — that choice must survive.
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      messages: [
        {
          id: "msg-otp",
          direction: "inbound",
          body: "Your verification code is 847291. This code expires in 10 minutes.",
          fromE164: "noreply@app.com",
          createdAt: now,
        },
      ],
    })
    mockStateFindUnique.mockResolvedValue({
      source: "user_override",
      metadataJson: {
        attentionCorrectedByUser: true,
        userOverride: true,
        attentionCategory: "read_later",
      },
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    // The email classifier always writes an update with emailType; verify it keeps the user's value
    const emailClassifierUpdate = mockStateUpdate.mock.calls.find(
      (c: unknown[]) => {
        const data = (c[0] as Record<string, { metadataJson?: Record<string, unknown> }>).data
        return data?.metadataJson?.emailType !== undefined
      }
    )
    expect(emailClassifierUpdate).toBeDefined()
    const updatedMeta = (emailClassifierUpdate![0] as Record<string, { metadataJson: Record<string, unknown> }>).data.metadataJson
    expect(updatedMeta.attentionCategory).toBe("read_later")   // user's choice preserved
    expect(updatedMeta.emailType).toBe("notification")         // AI-derived type still written
  })

  it("preserves user-corrected attentionCategory when userOverride (from status route) is set", async () => {
    // When a user clicks Done, the status route sets userOverride:true but NOT attentionCorrectedByUser.
    // The classifier must still respect userOverride and not clobber the attention.
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      status: "closed",
      messages: [
        {
          id: "msg-newsletter",
          direction: "inbound",
          body: "Unsubscribe from this newsletter. View in browser.",
          fromE164: "newsletter@example.com",
          createdAt: now,
        },
      ],
    })
    mockStateFindUnique.mockResolvedValue({
      source: "user_override",
      metadataJson: {
        userOverride: true,
        attentionCategory: "needs_reply",  // user set this before clicking Done
      },
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    const emailClassifierUpdate = mockStateUpdate.mock.calls.find(
      (c: unknown[]) => {
        const data = (c[0] as Record<string, { metadataJson?: Record<string, unknown> }>).data
        return data?.metadataJson?.emailType !== undefined
      }
    )
    expect(emailClassifierUpdate).toBeDefined()
    const updatedMeta = (emailClassifierUpdate![0] as Record<string, { metadataJson: Record<string, unknown> }>).data.metadataJson
    // Should NOT have overwritten with "read_later" (newsletter classifier result)
    expect(updatedMeta.attentionCategory).toBe("needs_reply")
  })

  it("writes AI-derived attentionCategory when no user override is present", async () => {
    // No user override — the email classifier result should be written normally
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      messages: [
        {
          id: "msg-otp",
          direction: "inbound",
          body: "Your verification code is 847291. This code expires in 10 minutes.",
          fromE164: "noreply@app.com",
          createdAt: now,
        },
      ],
    })
    mockStateFindUnique.mockResolvedValue(null)  // no existing state

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
    })

    const emailClassifierUpdate = mockStateUpdate.mock.calls.find(
      (c: unknown[]) => {
        const data = (c[0] as Record<string, { metadataJson?: Record<string, unknown> }>).data
        return data?.metadataJson?.emailType !== undefined
      }
    )
    expect(emailClassifierUpdate).toBeDefined()
    const updatedMeta = (emailClassifierUpdate![0] as Record<string, { metadataJson: Record<string, unknown> }>).data.metadataJson
    expect(updatedMeta.attentionCategory).toBe("needs_action")
  })

  it("can skip rich AI relationship work while still syncing deterministic state", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...conversation,
      label: null,
      messages: [
        {
          id: "msg-human",
          direction: "inbound",
          body: "Could you reply with the final address for tomorrow's meeting?",
          fromE164: "alice@example.com",
          createdAt: now,
        },
      ],
    })

    await syncConversationWorkItems({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      now,
      enableRichAi: false,
    })

    expect(mockStateUpsert).toHaveBeenCalled()
    expect(mockSyncPersonMemoryWithLLM).not.toHaveBeenCalled()
  })
})
