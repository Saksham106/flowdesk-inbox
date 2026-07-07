import { describe, it, expect, vi, beforeEach } from "vitest"

// Rule dry-run must mutate NOTHING: no writeback rows, no Gmail calls, no
// conversation-state changes. The only allowed writes are one AuditLog row
// ("dry-run executed") and, when a saved rule is dry-run, its lastDryRunAt.

const {
  mockAgentRuleFindFirst,
  mockAgentRuleUpdate,
  mockConvFindMany,
  mockAuditCreate,
  mockAutopilotFindUnique,
  mockWritebackUpsert,
  mockWritebackCreate,
  mockConvStateUpdate,
  mockSenderRuleUpdate,
} = vi.hoisted(() => ({
  mockAgentRuleFindFirst: vi.fn(),
  mockAgentRuleUpdate: vi.fn(),
  mockConvFindMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAutopilotFindUnique: vi.fn(),
  mockWritebackUpsert: vi.fn(),
  mockWritebackCreate: vi.fn(),
  mockConvStateUpdate: vi.fn(),
  mockSenderRuleUpdate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRule: { findFirst: mockAgentRuleFindFirst, update: mockAgentRuleUpdate },
    conversation: { findMany: mockConvFindMany },
    auditLog: { create: mockAuditCreate },
    autopilotSetting: { findUnique: mockAutopilotFindUnique },
    // Present only so the test can prove they are never touched:
    gmailWritebackQueue: { upsert: mockWritebackUpsert, create: mockWritebackCreate },
    conversationState: { update: mockConvStateUpdate },
    senderRule: { update: mockSenderRuleUpdate },
  },
}))

let mockSession: unknown = null
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/google", () => ({
  extractEmail: (raw: string) => {
    const m = raw.match(/<([^>]+)>/)
    return m ? m[1] : raw
  },
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { POST as dryRun } from "@/app/api/agent-rules/dry-run/route"

function makeReq(body: Record<string, unknown> = {}): Request {
  return { json: async () => body } as unknown as Request
}

const TENANT = "tenant-A"

const conversations = [
  {
    id: "conv-1",
    messages: [
      {
        direction: "inbound",
        fromE164: "Beehiiv <news@beehiiv.com>",
        subject: "Weekly Digest",
        body: "Latest posts. Unsubscribe anytime.",
      },
    ],
  },
  {
    id: "conv-2",
    messages: [
      {
        direction: "inbound",
        fromE164: "Tim <tim@5by5.tv>",
        subject: "Invoice",
        body: "Here is the invoice.",
      },
    ],
  },
  { id: "conv-3", messages: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockSession = { user: { id: "user1", tenantId: TENANT } }
  mockConvFindMany.mockResolvedValue(conversations)
  mockAuditCreate.mockResolvedValue({})
  mockAgentRuleUpdate.mockResolvedValue({})
  mockAutopilotFindUnique.mockResolvedValue({ automationLevel: 2, enabled: false })
})

describe("POST /api/agent-rules/dry-run", () => {
  it("returns 401 without a session", async () => {
    mockSession = null
    const res = await dryRun(makeReq({ conditions: { matchType: "domain", matchValue: "beehiiv.com" } }))
    expect(res.status).toBe(401)
    expect(mockConvFindMany).not.toHaveBeenCalled()
  })

  it("returns 400 when neither ruleId nor conditions are provided", async () => {
    const res = await dryRun(makeReq({}))
    expect(res.status).toBe(400)
  })

  it("returns 422 for unusable conditions", async () => {
    const res = await dryRun(makeReq({ conditions: { matchType: "regex", matchValue: ".*" } }))
    expect(res.status).toBe(422)
  })

  it("returns 404 when the rule does not belong to the tenant", async () => {
    mockAgentRuleFindFirst.mockResolvedValue(null)
    const res = await dryRun(makeReq({ ruleId: "rule-other-tenant" }))
    expect(res.status).toBe(404)
    expect(mockAgentRuleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "rule-other-tenant", tenantId: TENANT }) })
    )
  })

  it("previews inline conditions: matched vs skipped, evidence, planned actions", async () => {
    const res = await dryRun(
      makeReq({
        conditions: { matchType: "domain", matchValue: "beehiiv.com" },
        action: { targetAttention: "read_later" },
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    expect(body.matchedCount).toBe(1)
    expect(body.skippedCount).toBe(2)
    const matches = body.matches as Array<Record<string, unknown>>
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      conversationId: "conv-1",
      fromEmail: "news@beehiiv.com",
      subject: "Weekly Digest",
    })
    expect((matches[0].evidence as string[]).join(" ")).toContain("beehiiv.com")

    const planned = body.plannedAction as Record<string, unknown>
    expect(planned.targetAttention).toBe("read_later")
    expect(planned.gmailLabels).toContain("Read Later")
    expect(body.automationLevel).toBe(2)
    expect(body.wouldApplyGmailLabels).toBe(true)
  })

  it("scopes the conversation sample to the tenant and caps it at 200", async () => {
    await dryRun(
      makeReq({ conditions: { matchType: "domain", matchValue: "beehiiv.com" }, sampleSize: 5000 })
    )
    expect(mockConvFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
        take: 200,
      })
    )
  })

  it("mutates nothing except one audit row (inline mode)", async () => {
    await dryRun(makeReq({ conditions: { matchType: "domain", matchValue: "beehiiv.com" } }))

    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, action: "agent_rule.dry_run" }),
      })
    )
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
    expect(mockWritebackCreate).not.toHaveBeenCalled()
    expect(mockConvStateUpdate).not.toHaveBeenCalled()
    expect(mockSenderRuleUpdate).not.toHaveBeenCalled()
    expect(mockAgentRuleUpdate).not.toHaveBeenCalled()
  })

  it("dry-running a saved rule records lastDryRunAt on that rule only", async () => {
    mockAgentRuleFindFirst.mockResolvedValue({
      id: "rule-1",
      tenantId: TENANT,
      version: 4,
      conditionsJson: { matchType: "email", matchValue: "tim@5by5.tv" },
      actionJson: { targetAttention: "quiet" },
    })

    const res = await dryRun(makeReq({ ruleId: "rule-1" }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.matchedCount).toBe(1)
    expect(body.ruleVersion).toBe(4)

    expect(mockAgentRuleUpdate).toHaveBeenCalledTimes(1)
    expect(mockAgentRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1" },
        data: expect.objectContaining({ lastDryRunAt: expect.any(Date) }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockWritebackUpsert).not.toHaveBeenCalled()
    expect(mockConvStateUpdate).not.toHaveBeenCalled()
  })
})
