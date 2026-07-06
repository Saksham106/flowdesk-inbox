import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockLabelMappingFindMany,
  mockWritebackUpsert,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockLabelMappingFindMany: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst },
    gmailLabelMapping: { findMany: mockLabelMappingFindMany },
    gmailWritebackQueue: { upsert: mockWritebackUpsert },
    auditLog: { create: mockAuditCreate },
  },
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

  it("does not queue when every applicable label is disabled", async () => {
    mockConversationFindFirst.mockResolvedValue(GOOGLE_CONVERSATION)
    mockLabelMappingFindMany.mockResolvedValue([
      { canonical: "FlowDesk/Needs Reply", enabled: false },
      { canonical: "FlowDesk/Needs Action", enabled: false },
    ])
    const job = await projectFlowDeskLabelsForConversation({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })
    expect(job).toBeNull()
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
  })
})
