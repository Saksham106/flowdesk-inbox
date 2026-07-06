import { describe, it, expect, vi, beforeEach } from "vitest"

// Rule versioning: behavior-changing edits preserve the prior version as an
// AuditLog snapshot and bump `version`; executions elsewhere record which
// version fired. Draft static rules cannot be enabled before a dry-run.

const {
  mockAgentRuleFindFirst,
  mockAgentRuleFindMany,
  mockAgentRuleCreate,
  mockAgentRuleUpdate,
  mockAuditCreate,
  mockAuditFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockAgentRuleFindFirst: vi.fn(),
  mockAgentRuleFindMany: vi.fn(),
  mockAgentRuleCreate: vi.fn(),
  mockAgentRuleUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockAuditFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRule: {
      findFirst: mockAgentRuleFindFirst,
      findMany: mockAgentRuleFindMany,
      create: mockAgentRuleCreate,
      update: mockAgentRuleUpdate,
      deleteMany: vi.fn(),
    },
    auditLog: { create: mockAuditCreate, findMany: mockAuditFindMany },
    $transaction: mockTransaction,
  },
}))

let mockSession: unknown = null
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/agent/rule-compiler", () => ({
  compileRule: vi.fn(),
  RuleCompileError: class RuleCompileError extends Error {},
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

import { POST as createRule } from "@/app/api/agent-rules/route"
import { PATCH as patchRule } from "@/app/api/agent-rules/[id]/route"
import { GET as getVersions } from "@/app/api/agent-rules/[id]/versions/route"

const TENANT = "tenant-A"

function makeReq(body: Record<string, unknown> = {}): Request {
  return { json: async () => body } as unknown as Request
}

const draftRule = {
  id: "rule-1",
  tenantId: TENANT,
  plainText: "Newsletters from beehiiv.com → read later",
  ruleType: "attention",
  conditionsJson: { matchType: "domain", matchValue: "beehiiv.com" },
  actionJson: { targetAttention: "read_later" },
  status: "draft",
  source: "manual",
  version: 1,
  lastDryRunAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession = { user: { id: "user1", tenantId: TENANT } }
  mockTransaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
  mockAgentRuleCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "rule-new",
    ...args.data,
  }))
  mockAgentRuleUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...draftRule,
    ...args.data,
  }))
  mockAuditCreate.mockResolvedValue({})
  mockAuditFindMany.mockResolvedValue([])
})

describe("POST /api/agent-rules with structured static conditions", () => {
  it("creates a draft manual rule without calling the LLM compiler", async () => {
    const res = await createRule(
      makeReq({
        plainText: "Beehiiv newsletters go to read later",
        conditions: { matchType: "domain", matchValue: "beehiiv.com", subjectContains: "digest" },
        action: { targetAttention: "read_later" },
      })
    )
    expect(res.status).toBe(201)

    const { compileRule } = await import("@/lib/agent/rule-compiler")
    expect(compileRule).not.toHaveBeenCalled()

    expect(mockAgentRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          ruleType: "attention",
          source: "manual",
          status: "draft",
          conditionsJson: expect.objectContaining({ matchType: "domain", matchValue: "beehiiv.com" }),
          actionJson: { targetAttention: "read_later" },
        }),
      })
    )
  })

  it("rejects structured rules with an invalid targetAttention", async () => {
    const res = await createRule(
      makeReq({
        conditions: { matchType: "domain", matchValue: "beehiiv.com" },
        action: { targetAttention: "delete_everything" },
      })
    )
    expect(res.status).toBe(422)
    expect(mockAgentRuleCreate).not.toHaveBeenCalled()
  })

  it("rejects structured rules with unusable conditions", async () => {
    const res = await createRule(
      makeReq({ conditions: {}, action: { targetAttention: "quiet" } })
    )
    expect(res.status).toBe(422)
  })
})

describe("PATCH /api/agent-rules/[id] versioning", () => {
  it("bumps version and snapshots the prior version on a conditions edit", async () => {
    mockAgentRuleFindFirst.mockResolvedValue({ ...draftRule, version: 2 })

    const res = await patchRule(
      makeReq({ conditions: { matchType: "domain", matchValue: "substack.com" } }),
      { params: { id: "rule-1" } }
    )
    expect(res.status).toBe(200)

    expect(mockAgentRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 3,
          conditionsJson: expect.objectContaining({ matchValue: "substack.com" }),
          lastDryRunAt: null,
        }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent_rule.version_snapshot",
          payloadJson: expect.objectContaining({
            ruleId: "rule-1",
            version: 2,
            conditionsJson: expect.objectContaining({ matchValue: "beehiiv.com" }),
            actionJson: { targetAttention: "read_later" },
          }),
        }),
      })
    )
  })

  it("does not bump version on a status-only change", async () => {
    mockAgentRuleFindFirst.mockResolvedValue({ ...draftRule, status: "active" })

    await patchRule(makeReq({ status: "paused" }), { params: { id: "rule-1" } })

    const updateArgs = mockAgentRuleUpdate.mock.calls[0][0]
    expect(updateArgs.data.version).toBeUndefined()
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "agent_rule.version_snapshot" }),
      })
    )
  })

  it("blocks enabling a draft rule that has never been dry-run", async () => {
    mockAgentRuleFindFirst.mockResolvedValue(draftRule)

    const res = await patchRule(makeReq({ status: "active" }), { params: { id: "rule-1" } })
    expect(res.status).toBe(422)
    expect(mockAgentRuleUpdate).not.toHaveBeenCalled()
  })

  it("enables a draft rule after a dry-run", async () => {
    mockAgentRuleFindFirst.mockResolvedValue({ ...draftRule, lastDryRunAt: new Date() })

    const res = await patchRule(makeReq({ status: "active" }), { params: { id: "rule-1" } })
    expect(res.status).toBe(200)
    expect(mockAgentRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) })
    )
  })

  it("rejects an invalid targetAttention on action edits", async () => {
    mockAgentRuleFindFirst.mockResolvedValue(draftRule)

    const res = await patchRule(
      makeReq({ action: { targetAttention: "explode" } }),
      { params: { id: "rule-1" } }
    )
    expect(res.status).toBe(422)
  })
})

describe("GET /api/agent-rules/[id]/versions", () => {
  it("returns the current version plus audit snapshots, tenant-scoped", async () => {
    mockAgentRuleFindFirst.mockResolvedValue({ ...draftRule, version: 3 })
    mockAuditFindMany.mockResolvedValue([
      {
        createdAt: new Date("2026-07-01"),
        payloadJson: {
          ruleId: "rule-1",
          version: 2,
          plainText: draftRule.plainText,
          conditionsJson: { matchType: "domain", matchValue: "beehiiv.com" },
          actionJson: { targetAttention: "read_later" },
        },
      },
    ])

    const res = await getVersions({} as Request, { params: { id: "rule-1" } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    expect(mockAgentRuleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "rule-1", tenantId: TENANT }) })
    )
    expect((body.current as Record<string, unknown>).version).toBe(3)
    const versions = body.versions as Array<Record<string, unknown>>
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 2 })
  })

  it("404s for a rule from another tenant", async () => {
    mockAgentRuleFindFirst.mockResolvedValue(null)
    const res = await getVersions({} as Request, { params: { id: "rule-x" } })
    expect(res.status).toBe(404)
    expect(mockAuditFindMany).not.toHaveBeenCalled()
  })
})
