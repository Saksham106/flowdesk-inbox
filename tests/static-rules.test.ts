import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAgentRuleFindMany, mockSenderRuleFindMany } = vi.hoisted(() => ({
  mockAgentRuleFindMany: vi.fn(),
  mockSenderRuleFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRule: { findMany: mockAgentRuleFindMany },
    senderRule: { findMany: mockSenderRuleFindMany },
  },
}))

import {
  parseStaticConditions,
  matchStaticConditions,
  evaluateStaticRules,
} from "@/lib/agent/static-rules"

const TENANT = "tenant-1"

beforeEach(() => {
  vi.clearAllMocks()
  mockAgentRuleFindMany.mockResolvedValue([])
  mockSenderRuleFindMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// parseStaticConditions
// ---------------------------------------------------------------------------
describe("parseStaticConditions", () => {
  it("parses sender email conditions", () => {
    expect(parseStaticConditions({ matchType: "email", matchValue: "Tim@5by5.tv" })).toEqual({
      matchType: "email",
      matchValue: "tim@5by5.tv",
    })
  })

  it("parses domain + subject + body conditions", () => {
    expect(
      parseStaticConditions({
        matchType: "domain",
        matchValue: "Beehiiv.com",
        subjectContains: "Invoice",
        bodyContains: "unsubscribe",
      })
    ).toEqual({
      matchType: "domain",
      matchValue: "beehiiv.com",
      subjectContains: "Invoice",
      bodyContains: "unsubscribe",
    })
  })

  it("returns null when no usable condition is present", () => {
    expect(parseStaticConditions({})).toBeNull()
    expect(parseStaticConditions(null)).toBeNull()
    expect(parseStaticConditions("nope")).toBeNull()
    expect(parseStaticConditions({ matchType: "email" })).toBeNull()
    expect(parseStaticConditions({ matchValue: "x@y.com" })).toBeNull()
  })

  it("rejects unknown matchType", () => {
    expect(parseStaticConditions({ matchType: "regex", matchValue: ".*" })).toBeNull()
  })

  it("keeps subject-only conditions", () => {
    expect(parseStaticConditions({ subjectContains: "receipt" })).toEqual({
      subjectContains: "receipt",
    })
  })
})

// ---------------------------------------------------------------------------
// matchStaticConditions
// ---------------------------------------------------------------------------
describe("matchStaticConditions", () => {
  const msg = {
    fromEmail: "news@beehiiv.com",
    subject: "Your Weekly Digest",
    body: "Read the latest. Unsubscribe anytime.",
  }

  it("matches sender email case-insensitively", () => {
    const res = matchStaticConditions(
      { matchType: "email", matchValue: "news@beehiiv.com" },
      { ...msg, fromEmail: "News@Beehiiv.com" }
    )
    expect(res.matched).toBe(true)
    expect(res.evidence.join(" ")).toContain("news@beehiiv.com")
  })

  it("matches sender domain", () => {
    const res = matchStaticConditions({ matchType: "domain", matchValue: "beehiiv.com" }, msg)
    expect(res.matched).toBe(true)
  })

  it("does not match a different domain", () => {
    const res = matchStaticConditions({ matchType: "domain", matchValue: "substack.com" }, msg)
    expect(res.matched).toBe(false)
  })

  it("matches subjectContains case-insensitively", () => {
    const res = matchStaticConditions({ subjectContains: "weekly digest" }, msg)
    expect(res.matched).toBe(true)
    expect(res.evidence.join(" ")).toContain("weekly digest")
  })

  it("matches bodyContains case-insensitively", () => {
    const res = matchStaticConditions({ bodyContains: "UNSUBSCRIBE" }, msg)
    expect(res.matched).toBe(true)
  })

  it("requires ALL present conditions to match (AND semantics)", () => {
    const res = matchStaticConditions(
      { matchType: "domain", matchValue: "beehiiv.com", subjectContains: "invoice" },
      msg
    )
    expect(res.matched).toBe(false)
  })

  it("does not match subject condition when the message has no subject", () => {
    const res = matchStaticConditions({ subjectContains: "digest" }, { ...msg, subject: "" })
    expect(res.matched).toBe(false)
  })

  it("returns no match for empty conditions", () => {
    expect(matchStaticConditions({}, msg).matched).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// evaluateStaticRules — DB-backed evaluation with precedence
// ---------------------------------------------------------------------------
describe("evaluateStaticRules", () => {
  const input = {
    tenantId: TENANT,
    fromEmail: "tim@5by5.tv",
    subject: "Podcast invoice",
    body: "Here is the invoice for this month.",
  }

  it("scopes both queries to the tenant and active status", async () => {
    await evaluateStaticRules(input)
    expect(mockAgentRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, status: "active" }),
      })
    )
    expect(mockSenderRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, status: "active" }),
      })
    )
  })

  it("returns null when nothing matches", async () => {
    expect(await evaluateStaticRules(input)).toBeNull()
  })

  it("matches an AgentRule and reports id/version/action", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-1",
        version: 3,
        ruleType: "attention",
        conditionsJson: { matchType: "email", matchValue: "tim@5by5.tv" },
        actionJson: { targetAttention: "read_later" },
      },
    ])
    const match = await evaluateStaticRules(input)
    expect(match).toMatchObject({
      ruleSource: "agent_rule",
      ruleId: "ar-1",
      ruleVersion: 3,
      targetAttention: "read_later",
    })
    expect(match?.evidence.length).toBeGreaterThan(0)
  })

  it("prefers AgentRule over SenderRule", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-1",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "5by5.tv" },
        actionJson: { targetAttention: "quiet" },
      },
    ])
    mockSenderRuleFindMany.mockResolvedValue([
      { id: "sr-1", version: 1, matchType: "email", matchValue: "tim@5by5.tv", targetAttention: "read_later" },
    ])
    const match = await evaluateStaticRules(input)
    expect(match?.ruleId).toBe("ar-1")
  })

  it("prefers email match over domain match within AgentRules", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-domain",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "5by5.tv" },
        actionJson: { targetAttention: "quiet" },
      },
      {
        id: "ar-email",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "email", matchValue: "tim@5by5.tv" },
        actionJson: { targetAttention: "read_later" },
      },
    ])
    const match = await evaluateStaticRules(input)
    expect(match?.ruleId).toBe("ar-email")
  })

  it("prefers SenderRule email match over SenderRule domain match", async () => {
    mockSenderRuleFindMany.mockResolvedValue([
      { id: "sr-domain", version: 1, matchType: "domain", matchValue: "5by5.tv", targetAttention: "quiet" },
      { id: "sr-email", version: 2, matchType: "email", matchValue: "tim@5by5.tv", targetAttention: "read_later" },
    ])
    const match = await evaluateStaticRules(input)
    expect(match).toMatchObject({ ruleSource: "sender_rule", ruleId: "sr-email", ruleVersion: 2 })
  })

  it("skips AgentRules whose action has no valid targetAttention", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-bad",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "email", matchValue: "tim@5by5.tv" },
        actionJson: {},
      },
    ])
    expect(await evaluateStaticRules(input)).toBeNull()
  })

  it("does not match a subject-conditioned rule when subject is unavailable", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-subj",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "5by5.tv", subjectContains: "invoice" },
        actionJson: { targetAttention: "read_later" },
      },
    ])
    expect(await evaluateStaticRules({ ...input, subject: "" })).toBeNull()
  })
})
