import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockLabelMappingFindMany,
  mockWritebackUpsert,
  mockWritebackFindUnique,
  mockAuditCreate,
  mockFollowUpSettingFindUnique,
  mockAutopilotSettingFindUnique,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockLabelMappingFindMany: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockWritebackFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockFollowUpSettingFindUnique: vi.fn(),
  mockAutopilotSettingFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst },
    gmailLabelMapping: { findMany: mockLabelMappingFindMany },
    gmailWritebackQueue: { upsert: mockWritebackUpsert, findUnique: mockWritebackFindUnique },
    auditLog: { create: mockAuditCreate },
    followUpSetting: { findUnique: mockFollowUpSettingFindUnique },
    autopilotSetting: { findUnique: mockAutopilotSettingFindUnique },
  },
}))

// The inline writeback drain (lib/agent/gmail-writeback-processor.ts) is a
// separate concern from label projection/queueing — stub it out so these
// tests aren't exercising real Gmail-API-adjacent code.
vi.mock("@/lib/agent/gmail-writeback-processor", () => ({
  processGmailWritebackJobById: vi.fn().mockResolvedValue({ ok: true }),
}))

import {
  filterEnabledFlowDeskLabels,
  projectFlowDeskLabelsForConversation,
} from "@/lib/gmail-labels"

const GOOGLE_CONVERSATION = {
  id: "conv-1",
  channelId: "channel-1",
  externalThreadId: "thread-1",
  label: null,
  status: "needs_reply",
  lastMessageAt: new Date(),
  channel: { provider: "google" },
  draft: null,
  stateRecord: { attentionCategory: "needs_action", emailType: null },
}

describe("filterEnabledFlowDeskLabels", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps all labels when the tenant has no mapping rows", async () => {
    mockLabelMappingFindMany.mockResolvedValue([])
    const result = await filterEnabledFlowDeskLabels("tenant-1", [
      "FlowDesk/Needs Reply",
      "FlowDesk/Needs Action",
    ])
    expect(result).toEqual(["FlowDesk/Needs Reply", "FlowDesk/Needs Action"])
  })

  it("drops labels the tenant has explicitly disabled", async () => {
    mockLabelMappingFindMany.mockResolvedValue([
      { canonical: "FlowDesk/Needs Action", enabled: false },
      { canonical: "FlowDesk/Needs Reply", enabled: true },
    ])
    const result = await filterEnabledFlowDeskLabels("tenant-1", [
      "FlowDesk/Needs Reply",
      "FlowDesk/Needs Action",
    ])
    expect(result).toEqual(["FlowDesk/Needs Reply"])
  })
})

describe("projectFlowDeskLabelsForConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLabelMappingFindMany.mockResolvedValue([])
    mockWritebackUpsert.mockResolvedValue({ id: "job-1" })
    mockAuditCreate.mockResolvedValue({})
    mockFollowUpSettingFindUnique.mockResolvedValue(null)
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 2, enabled: false })
  })

  it("no-ops below automation Level 2 (labels are the first Gmail-touching rung)", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 1, enabled: false })

    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(job).toBeNull()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("treats a tenant without an AutopilotSetting row as legacy Level 3 (labels still project)", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)
    mockAutopilotSettingFindUnique.mockResolvedValue(null)

    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(job).toEqual({ id: "job-1" })
  })

  it("queues an apply_labels writeback for a Google conversation", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)

    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(job).toEqual({ id: "job-1" })
    expect(mockWritebackUpsert).toHaveBeenCalledTimes(1)
    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.where.conversationId_action).toEqual({
      conversationId: "conv-1",
      action: "apply_labels",
    })
    expect(upsertArg.create.providerMessageIdsJson.labels).toEqual(
      expect.arrayContaining(["FlowDesk/Needs Reply", "FlowDesk/Needs Action"])
    )
    expect(upsertArg.create.providerMessageIdsJson.threadId).toBe("thread-1")
  })

  it("drains the queued job inline instead of waiting for the next cron tick", async () => {
    const { processGmailWritebackJobById } = await import("@/lib/agent/gmail-writeback-processor")
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)

    await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(processGmailWritebackJobById).toHaveBeenCalledWith("job-1")
  })

  it("resets retry state when refreshing an existing label writeback", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)

    await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.update).toEqual(
      expect.objectContaining({
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: expect.any(Date),
      })
    )
  })

  it("no-ops for non-Google channels", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...GOOGLE_CONVERSATION,
      channel: { provider: "microsoft" },
    })
    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })
    expect(job).toBeNull()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("no-ops when the conversation has no Gmail thread id", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...GOOGLE_CONVERSATION,
      externalThreadId: null,
    })
    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })
    expect(job).toBeNull()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("honors a manual user workflow choice over AI signals when re-projecting", async () => {
    // The user set Read Later by hand (userState is set with source "user" by
    // the workflow-status route); the automatic re-projection after the next
    // sync must not revert their choice to the AI-derived Needs Reply/Action.
    mockConversationFindFirst.mockResolvedValue({
      ...GOOGLE_CONVERSATION,
      userState: "read_later",
    })

    await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.create.providerMessageIdsJson.labels).toContain("FlowDesk/Read Later")
    expect(upsertArg.create.providerMessageIdsJson.labels).not.toContain("FlowDesk/Needs Reply")
  })

  it("adds Follow Up for a waiting-on conversation past the tenant delay", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...GOOGLE_CONVERSATION,
      status: "in_progress",
      stateRecord: null,
      // two weeks ago — past any small business-day delay
      lastMessageAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    })

    await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.create.providerMessageIdsJson.labels).toEqual(
      expect.arrayContaining(["FlowDesk/Waiting On", "FlowDesk/Follow Up"])
    )
  })

  it("does not add Follow Up before the delay elapses", async () => {
    mockConversationFindFirst.mockResolvedValue({
      ...GOOGLE_CONVERSATION,
      status: "in_progress",
      stateRecord: null,
      lastMessageAt: new Date(Date.now() - 60 * 60 * 1000), // an hour ago
    })

    await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.create.providerMessageIdsJson.labels).toEqual(["FlowDesk/Waiting On"])
  })

  it("does not queue an empty label set for a thread that was never labeled", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)
    mockLabelMappingFindMany.mockResolvedValue([
      { canonical: "FlowDesk/Needs Reply", enabled: false },
      { canonical: "FlowDesk/Needs Action", enabled: false },
    ])
    mockWritebackFindUnique.mockResolvedValue(null)

    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(job).toBeNull()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })

  it("queues an empty label set (remove all) for a previously labeled thread", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)
    mockLabelMappingFindMany.mockResolvedValue([
      { canonical: "FlowDesk/Needs Reply", enabled: false },
      { canonical: "FlowDesk/Needs Action", enabled: false },
    ])
    mockWritebackFindUnique.mockResolvedValue({ id: "job-prior" })

    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })

    expect(job).toEqual({ id: "job-1" })
    expect(mockWritebackUpsert).toHaveBeenCalledTimes(1)
    const upsertArg = mockWritebackUpsert.mock.calls[0][0]
    expect(upsertArg.create.providerMessageIdsJson.labels).toEqual([])
    expect(upsertArg.update.providerMessageIdsJson.labels).toEqual([])
  })
})
