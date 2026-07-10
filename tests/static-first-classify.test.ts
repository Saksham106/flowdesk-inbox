import { describe, it, expect, vi, beforeEach } from "vitest"

// Static-first rule evaluation in the agent-job classification path:
// a static rule match must short-circuit BEFORE any AI gateway call — no
// OpenRouter request, no AI budget spend, no AiUsageEvent row.

const {
  mockConvFindFirst,
  mockJobFindUnique,
  mockJobUpdate,
  mockToolCallCreate,
  mockToolCallUpdate,
  mockAuditCreate,
  mockAiUsageCreate,
  mockAgentRuleFindMany,
  mockSenderRuleFindMany,
  mockGetFullBusinessContext,
  mockTenantFindUnique,
  mockUserFindFirst,
  mockRunAiJsonFeature,
} = vi.hoisted(() => ({
  mockConvFindFirst: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockToolCallCreate: vi.fn(),
  mockToolCallUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAiUsageCreate: vi.fn(),
  mockAgentRuleFindMany: vi.fn(),
  mockSenderRuleFindMany: vi.fn(),
  mockGetFullBusinessContext: vi.fn(),
  mockTenantFindUnique: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockRunAiJsonFeature: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConvFindFirst },
    agentJob: { create: vi.fn(), findUnique: mockJobFindUnique, update: mockJobUpdate },
    agentToolCall: { create: mockToolCallCreate, update: mockToolCallUpdate },
    auditLog: { create: mockAuditCreate },
    aiUsageEvent: { create: mockAiUsageCreate },
    tenant: { findUnique: mockTenantFindUnique },
    agentRule: { findMany: mockAgentRuleFindMany },
    senderRule: { findMany: mockSenderRuleFindMany },
    user: { findFirst: mockUserFindFirst },
  },
}))

vi.mock("@/lib/ai/gateway", () => ({
  runAiJsonFeature: mockRunAiJsonFeature,
}))

vi.mock("@/lib/agent/context", () => ({
  getFullBusinessContext: mockGetFullBusinessContext,
}))

vi.mock("@/lib/google", () => ({
  extractEmail: (raw: string) => {
    const m = raw.match(/<([^>]+)>/)
    return m ? m[1] : raw
  },
}))

vi.mock("@/lib/agent/availability", () => ({
  checkAvailability: vi.fn(),
  formatSlots: (slots: unknown[]) => slots,
}))

import { runAgentJob } from "@/lib/agent/jobs"

const TENANT = "tenant-1"
const CONV_ID = "conv-1"
const JOB_ID = "job-1"
const OWNER = { id: "owner-1", email: "owner@example.com" }

const baseJob = {
  id: JOB_ID,
  tenantId: TENANT,
  conversationId: CONV_ID,
  trigger: "manual",
  status: "pending" as const,
}

const newsletterMessage = {
  direction: "inbound",
  fromE164: "Beehiiv <news@beehiiv.com>",
  subject: "Your Weekly Digest",
  body: "Read the latest posts. Unsubscribe anytime.",
  createdAt: new Date(),
}

const matchingAgentRule = {
  id: "ar-1",
  version: 2,
  ruleType: "attention",
  conditionsJson: { matchType: "domain", matchValue: "beehiiv.com" },
  actionJson: { targetAttention: "read_later" },
}

const llmClassification = {
  intent: "booking_request",
  attentionCategory: "needs_reply",
  classificationReason: "Customer asks about booking.",
  confidence: 0.85,
  riskLevel: "low",
  suggestedLabel: "Lead",
  escalationReason: null,
  requiresApproval: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockJobFindUnique.mockResolvedValue(baseJob)
  mockJobUpdate.mockResolvedValue({})
  mockConvFindFirst.mockResolvedValue({
    id: CONV_ID,
    tenantId: TENANT,
    messages: [newsletterMessage],
  })
  mockGetFullBusinessContext.mockResolvedValue({ profile: null, documents: [] })
  mockTenantFindUnique.mockResolvedValue({ salesCrmEnabled: true })
  mockToolCallCreate.mockResolvedValue({ id: "tc-1" })
  mockToolCallUpdate.mockResolvedValue({})
  mockAuditCreate.mockResolvedValue({})
  mockAiUsageCreate.mockResolvedValue({})
  mockAgentRuleFindMany.mockResolvedValue([])
  mockSenderRuleFindMany.mockResolvedValue([])
  mockUserFindFirst.mockResolvedValue(OWNER)
  mockRunAiJsonFeature.mockResolvedValue({
    output: llmClassification,
    model: "anthropic/claude-sonnet-4.5",
    providerGenerationId: "gen-1",
  })
})

describe("static-first classification in runAgentJob", () => {
  it("uses the static rule result and never calls the model or spends budget", async () => {
    mockAgentRuleFindMany.mockResolvedValue([matchingAgentRule])

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("completed")
    // No model call, no usage row: zero budget spend.
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).not.toHaveBeenCalled()

    // Execution history records which rule (and version) fired.
    expect(mockToolCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          outputJson: expect.objectContaining({
            source: "static_rule",
            ruleId: "ar-1",
            ruleVersion: 2,
            attentionCategory: "read_later",
          }),
        }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent_job.completed",
          payloadJson: expect.objectContaining({
            classificationSource: "static_rule",
            ruleId: "ar-1",
            ruleVersion: 2,
          }),
        }),
      })
    )
  })

  it("static rule classification is deterministic: confidence 1 and the rule's attention", async () => {
    mockAgentRuleFindMany.mockResolvedValue([matchingAgentRule])

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.confidence).toBe(1)
    }
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", confidence: 1 }),
      })
    )
  })

  it("falls back to the AI gateway path when no static rule matches", async () => {
    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.intent).toBe("booking_request")
    }
    expect(mockRunAiJsonFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: OWNER.id,
        userEmail: OWNER.email,
        feature: "agent.classify",
      })
    )
  })

  it("keeps the LLM budget gate on the fallback path", async () => {
    mockRunAiJsonFeature.mockRejectedValue(new Error("Daily AI spend limit reached"))

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("failed")
  })

  it("fails clearly when the tenant has no user to attribute the AI call to", async () => {
    mockUserFindFirst.mockResolvedValue(null)

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("failed")
    expect(mockRunAiJsonFeature).not.toHaveBeenCalled()
  })

  it("skips static evaluation gracefully when the conversation has no inbound message", async () => {
    mockConvFindFirst.mockResolvedValue({
      id: CONV_ID,
      tenantId: TENANT,
      messages: [{ direction: "outbound", body: "Hi", createdAt: new Date() }],
    })
    mockAgentRuleFindMany.mockResolvedValue([matchingAgentRule])

    const result = await runAgentJob(JOB_ID)

    expect(result.status).toBe("completed")
    expect(mockRunAiJsonFeature).toHaveBeenCalled()
  })
})
