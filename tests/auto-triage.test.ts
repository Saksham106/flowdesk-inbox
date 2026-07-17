import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetAutomationLevel,
  mockConversationFindFirst,
  mockConversationUpdate,
  mockConversationStateUpdate,
  mockQueueUpsert,
  mockQueueFindMany,
  mockAuditCreate,
  mockProcessJobById,
} = vi.hoisted(() => ({
  mockGetAutomationLevel: vi.fn(),
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockConversationStateUpdate: vi.fn(),
  mockQueueUpsert: vi.fn(),
  mockQueueFindMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockProcessJobById: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst, update: mockConversationUpdate },
    conversationState: { update: mockConversationStateUpdate },
    emailWritebackQueue: { upsert: mockQueueUpsert, findMany: mockQueueFindMany },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/agent/automation-level", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/automation-level")>()),
  getAutomationLevel: mockGetAutomationLevel,
}))

vi.mock("@/lib/agent/email-writeback-processor", () => ({
  processEmailWritebackJobById: mockProcessJobById,
}))

const { maybeAutoTriageConversation, ARCHIVE_THREAD_ACTION } = await import("@/lib/agent/auto-triage")

function lowRiskConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    channelId: "channel-1",
    externalThreadId: "thread-1",
    status: "needs_reply",
    userState: null,
    readAt: null,
    gmailUnread: true,
    channel: { provider: "google" },
    draft: null,
    stateRecord: { attentionCategory: null, emailType: "newsletter", metadataJson: {} },
    messages: [{ direction: "inbound", providerMessageId: "gmail_abc" }],
    ...overrides,
  }
}

describe("maybeAutoTriageConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAutomationLevel.mockResolvedValue(4)
    mockConversationFindFirst.mockResolvedValue(lowRiskConversation())
    mockConversationUpdate.mockResolvedValue({})
    mockConversationStateUpdate.mockResolvedValue({})
    mockQueueUpsert.mockResolvedValue({ id: "job-1" })
    mockQueueFindMany.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }])
    mockAuditCreate.mockResolvedValue({})
    mockProcessJobById.mockResolvedValue({ ok: true })
  })

  it("queues mark_read and archive for low-risk mail at Level 4", async () => {
    const result = await maybeAutoTriageConversation({ tenantId: "t1", conversationId: "conv-1" })

    expect(result).toEqual({ markedRead: true, archived: true })
    const actions = mockQueueUpsert.mock.calls.map((call) => call[0].create.action)
    expect(actions).toContain("mark_read")
    expect(actions).toContain(ARCHIVE_THREAD_ACTION)

    const markReadCall = mockQueueUpsert.mock.calls.find((call) => call[0].create.action === "mark_read")
    expect(markReadCall?.[0].create.providerMessageIdsJson).toEqual(["gmail_abc"])
    const archiveCall = mockQueueUpsert.mock.calls.find(
      (call) => call[0].create.action === ARCHIVE_THREAD_ACTION
    )
    expect(archiveCall?.[0].create.providerMessageIdsJson).toEqual({ threadId: "thread-1" })

    // In-app mirror + once-only marker + audit trail
    expect(mockConversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gmailUnread: false }) })
    )
    expect(mockConversationStateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ autoTriage: expect.objectContaining({ actions: ["mark_read", ARCHIVE_THREAD_ACTION] }) }),
        }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "automation.auto_triage" }) })
    )
    // Inline drain of both queued jobs
    expect(mockProcessJobById).toHaveBeenCalledTimes(2)
  })

  it("no-ops below Level 4", async () => {
    mockGetAutomationLevel.mockResolvedValue(3)

    const result = await maybeAutoTriageConversation({ tenantId: "t1", conversationId: "conv-1" })

    expect(result).toBeNull()
    expect(mockConversationFindFirst).not.toHaveBeenCalled()
    expect(mockQueueUpsert).not.toHaveBeenCalled()
  })

  it.each([
    ["a reply-shaped email type", { stateRecord: { attentionCategory: null, emailType: "needs_reply", metadataJson: {} } }],
    ["a blocking attention category", { stateRecord: { attentionCategory: "needs_action", emailType: "newsletter", metadataJson: {} } }],
    ["an explicit user state", { userState: "read_later" }],
    ["a label override", { stateRecord: { attentionCategory: null, emailType: "newsletter", metadataJson: { gmailLabelOverride: { updatedAt: "2026-07-16T00:00:00Z" } } } }],
    ["an already-triaged conversation", { stateRecord: { attentionCategory: null, emailType: "newsletter", metadataJson: { autoTriage: { at: "2026-07-16T00:00:00Z" } } } }],
    ["an outbound message", { messages: [{ direction: "inbound", providerMessageId: "gmail_abc" }, { direction: "outbound", providerMessageId: "gmail_def" }] }],
    ["an active proposed draft", { draft: { status: "proposed" } }],
    ["a non-writeback provider", { channel: { provider: "twilio" } }],
    ["a missing thread id", { externalThreadId: "" }],
  ])("skips %s", async (_label, overrides) => {
    mockConversationFindFirst.mockResolvedValue(lowRiskConversation(overrides))

    const result = await maybeAutoTriageConversation({ tenantId: "t1", conversationId: "conv-1" })

    expect(result).toBeNull()
    expect(mockQueueUpsert).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it("archives without re-queueing mark_read when the thread is already read", async () => {
    mockConversationFindFirst.mockResolvedValue(
      lowRiskConversation({ gmailUnread: false, readAt: new Date("2026-07-16T00:00:00Z") })
    )
    mockQueueFindMany.mockResolvedValue([{ id: "job-2" }])

    const result = await maybeAutoTriageConversation({ tenantId: "t1", conversationId: "conv-1" })

    expect(result).toEqual({ markedRead: false, archived: true })
    const actions = mockQueueUpsert.mock.calls.map((call) => call[0].create.action)
    expect(actions).toEqual([ARCHIVE_THREAD_ACTION])
  })
})
