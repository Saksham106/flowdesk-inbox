import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockMessageFindFirst,
  mockCorrectionCreate,
  mockCorrectionCount,
  mockRuleUpsert,
  mockSenderRuleFindMany,
  mockAgentRuleFindMany,
} = vi.hoisted(() => ({
  mockMessageFindFirst: vi.fn(),
  mockCorrectionCreate: vi.fn(),
  mockCorrectionCount: vi.fn(),
  mockRuleUpsert: vi.fn(),
  mockSenderRuleFindMany: vi.fn(),
  mockAgentRuleFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { findFirst: mockMessageFindFirst },
    classificationCorrection: {
      create: mockCorrectionCreate,
      count: mockCorrectionCount,
    },
    senderRule: {
      upsert: mockRuleUpsert,
      findMany: mockSenderRuleFindMany,
    },
    agentRule: {
      findMany: mockAgentRuleFindMany,
    },
  },
}))

vi.mock("@/lib/google", () => ({
  extractEmail: (raw: string) => {
    const m = raw.match(/<([^>]+)>/)
    return m ? m[1] : raw
  },
}))

import {
  extractDomainFromEmail,
  recordAttentionCorrection,
  applyActiveRule,
} from "@/lib/agent/preference-learning"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT = "tenant-1"
const CONV = "conv-abc"

beforeEach(() => {
  vi.clearAllMocks()
  mockCorrectionCreate.mockResolvedValue({})
  mockRuleUpsert.mockResolvedValue({})
  mockSenderRuleFindMany.mockResolvedValue([])
  mockAgentRuleFindMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// extractDomainFromEmail
// ---------------------------------------------------------------------------
describe("extractDomainFromEmail", () => {
  it("extracts the domain part after @", () => {
    expect(extractDomainFromEmail("user@example.com")).toBe("example.com")
  })

  it("handles angle-bracket format", () => {
    expect(extractDomainFromEmail("Name <user@sub.domain.org>")).toBe("sub.domain.org")
  })

  it("returns empty string when no @ is present", () => {
    expect(extractDomainFromEmail("not-an-email")).toBe("")
  })

  it("lowercases the domain", () => {
    expect(extractDomainFromEmail("user@EXAMPLE.COM")).toBe("example.com")
  })
})

// ---------------------------------------------------------------------------
// recordAttentionCorrection
// ---------------------------------------------------------------------------
describe("recordAttentionCorrection", () => {
  beforeEach(() => {
    mockMessageFindFirst.mockResolvedValue({
      fromE164: "sender@example.com",
    })
  })

  it("does nothing when no inbound message is found", async () => {
    mockMessageFindFirst.mockResolvedValue(null)
    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: null, newAttention: "quiet" })
    expect(mockCorrectionCreate).not.toHaveBeenCalled()
  })

  it("creates a ClassificationCorrection record", async () => {
    mockCorrectionCount.mockResolvedValue(1)
    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: "needs_reply", newAttention: "quiet" })

    expect(mockCorrectionCreate).toHaveBeenCalledOnce()
    expect(mockCorrectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        conversationId: CONV,
        fromEmail: "sender@example.com",
        fromDomain: "example.com",
        previousAttention: "needs_reply",
        newAttention: "quiet",
      }),
    })
  })

  it("does not upsert a rule when count is below threshold", async () => {
    mockCorrectionCount.mockResolvedValue(2)
    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: null, newAttention: "quiet" })
    expect(mockRuleUpsert).not.toHaveBeenCalled()
  })

  it("upserts an email-level SenderRule when email count reaches threshold", async () => {
    // First count call is for email, return 3 (threshold hit)
    mockCorrectionCount.mockResolvedValue(3)

    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: null, newAttention: "quiet" })

    expect(mockRuleUpsert).toHaveBeenCalledOnce()
    expect(mockRuleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matchType: "email", matchValue: "sender@example.com", targetAttention: "quiet", status: "suggested" }),
        update: expect.objectContaining({ triggerCount: 3 }),
      })
    )
  })

  it("upserts a domain-level rule when email count is low but domain count hits threshold", async () => {
    // First count (email) = 1, second count (domain) = 3
    mockCorrectionCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)

    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: null, newAttention: "read_later" })

    expect(mockRuleUpsert).toHaveBeenCalledOnce()
    expect(mockRuleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matchType: "domain", matchValue: "example.com", targetAttention: "read_later", status: "suggested" }),
      })
    )
  })

  it("prefers email-level rule over domain-level rule", async () => {
    // Email count is at threshold; domain check should never be reached
    mockCorrectionCount.mockResolvedValue(5)

    await recordAttentionCorrection({ tenantId: TENANT, conversationId: CONV, previousAttention: null, newAttention: "fyi_done" })

    // Only one upsert, with matchType email
    expect(mockRuleUpsert).toHaveBeenCalledOnce()
    expect(mockRuleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matchType: "email" }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// applyActiveRule
// ---------------------------------------------------------------------------
describe("applyActiveRule", () => {
  function senderRule(overrides: Record<string, unknown>) {
    return { id: "sr-1", version: 1, matchType: "email", matchValue: "user@example.com", targetAttention: "quiet", ...overrides }
  }

  it("returns null when no active rule matches", async () => {
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBeNull()
  })

  it("returns the attention category from an email-level rule", async () => {
    mockSenderRuleFindMany.mockResolvedValue([senderRule({ targetAttention: "quiet" })])
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBe("quiet")
  })

  it("falls back to domain-level rule when no email rule exists", async () => {
    mockSenderRuleFindMany.mockResolvedValue([
      senderRule({ matchType: "domain", matchValue: "example.com", targetAttention: "read_later" }),
    ])
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBe("read_later")
  })

  it("prefers email-level rule over domain-level rule", async () => {
    mockSenderRuleFindMany.mockResolvedValue([
      senderRule({ id: "sr-domain", matchType: "domain", matchValue: "example.com", targetAttention: "read_later" }),
      senderRule({ id: "sr-email", targetAttention: "needs_reply" }),
    ])
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBe("needs_reply")
  })

  it("prefers an AgentRule over a SenderRule", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-1",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "domain", matchValue: "example.com" },
        actionJson: { targetAttention: "fyi_done" },
      },
    ])
    mockSenderRuleFindMany.mockResolvedValue([senderRule({ targetAttention: "quiet" })])
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBe("fyi_done")
  })

  it("does not apply rules with subject/body conditions when only the sender is known", async () => {
    mockAgentRuleFindMany.mockResolvedValue([
      {
        id: "ar-1",
        version: 1,
        ruleType: "attention",
        conditionsJson: { matchType: "email", matchValue: "user@example.com", subjectContains: "invoice" },
        actionJson: { targetAttention: "quiet" },
      },
    ])
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "user@example.com" })
    expect(result).toBeNull()
  })

  it("returns null when fromEmail has no valid domain", async () => {
    const result = await applyActiveRule({ tenantId: TENANT, fromEmail: "not-an-email" })
    expect(result).toBeNull()
  })
})
