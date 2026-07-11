import { describe, expect, it, vi, beforeEach } from "vitest"

const {
  mockConvFindFirst, mockJobFindUnique, mockJobUpdate, mockToolCallCreate,
  mockToolCallUpdate, mockAuditCreate, mockTenantFindUnique, mockUserFindFirst,
  mockClassify,
} = vi.hoisted(() => ({
  mockConvFindFirst: vi.fn(), mockJobFindUnique: vi.fn(), mockJobUpdate: vi.fn(),
  mockToolCallCreate: vi.fn(), mockToolCallUpdate: vi.fn(), mockAuditCreate: vi.fn(),
  mockTenantFindUnique: vi.fn(), mockUserFindFirst: vi.fn(), mockClassify: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {
  conversation: { findFirst: mockConvFindFirst },
  agentJob: { findUnique: mockJobFindUnique, update: mockJobUpdate },
  agentToolCall: { create: mockToolCallCreate, update: mockToolCallUpdate },
  auditLog: { create: mockAuditCreate }, tenant: { findUnique: mockTenantFindUnique },
  user: { findFirst: mockUserFindFirst },
} }))
vi.mock("@/lib/agent/context", () => ({ getFullBusinessContext: vi.fn().mockResolvedValue({ profile: null }) }))
vi.mock("@/lib/agent/classify", () => ({ classifyConversation: mockClassify, tryStaticClassification: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/agent/availability", () => ({ checkAvailability: vi.fn(), formatSlots: vi.fn() }))
vi.mock("@/lib/google", () => ({ extractEmail: (value: string) => value }))

import { runAgentJob } from "@/lib/agent/jobs"
import { normalizePersistedAttentionCategory } from "@/lib/ai/prompts/classify"

describe("runAgentJob Gmail overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobFindUnique.mockResolvedValue({ id: "job-1", tenantId: "tenant-1", conversationId: "conv-1", trigger: "manual" })
    mockJobUpdate.mockResolvedValue({})
    mockToolCallCreate.mockResolvedValue({ id: "tool-1" })
    mockToolCallUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    mockTenantFindUnique.mockResolvedValue({ salesCrmEnabled: false })
    mockUserFindFirst.mockResolvedValue({ id: "user-1", email: "me@example.com" })
  })

  it("skips classification when a Gmail label override is active", async () => {
    mockConvFindFirst.mockResolvedValue({
      id: "conv-1", tenantId: "tenant-1", messages: [],
      stateRecord: { metadataJson: { gmailLabelOverride: { workflow: "Read Later", contentType: null } } },
    })

    const result = await runAgentJob("job-1")

    expect(result).toEqual({ status: "completed", intent: "gmail_label_override", confidence: 1, requiresApproval: false, autopilotSent: false })
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it("falls back safely when a Gmail override has an invalid persisted attention category", async () => {
    mockConvFindFirst.mockResolvedValue({
      id: "conv-1", tenantId: "tenant-1", messages: [],
      stateRecord: {
        attentionCategory: "not_a_category",
        metadataJson: { gmailLabelOverride: { workflow: "Read Later", contentType: null } },
      },
    })

    await runAgentJob("job-1")

    expect(normalizePersistedAttentionCategory("not_a_category")).toBe("quiet")
    expect(mockClassify).not.toHaveBeenCalled()
  })
})
