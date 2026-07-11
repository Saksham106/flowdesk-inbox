import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockChannelFindMany,
  mockAuditFindMany,
  mockConversationFindMany,
  mockGetAutomationLevel,
  mockReconcile,
} = vi.hoisted(() => ({
  mockChannelFindMany: vi.fn(),
  mockAuditFindMany: vi.fn(),
  mockConversationFindMany: vi.fn(),
  mockGetAutomationLevel: vi.fn(),
  mockReconcile: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findMany: mockChannelFindMany },
    auditLog: { findMany: mockAuditFindMany },
    conversation: { findMany: mockConversationFindMany },
  },
}))

vi.mock("@/lib/agent/email-label-reconcile", () => ({
  reconcileLabelsForChannel: mockReconcile,
}))

vi.mock("@/lib/agent/automation-level", () => ({
  getAutomationLevel: mockGetAutomationLevel,
  isActionAllowedAtLevel: (level: number) => level >= 2,
  MIN_LEVEL_FOR_ACTION: { apply_gmail_labels: 2 },
}))

import { runOnboardingFirstPass } from "@/lib/agent/onboarding-first-pass"

describe("runOnboardingFirstPass", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAutomationLevel.mockResolvedValue(2)
    mockReconcile.mockResolvedValue({ labelsEnsured: true, labelsEnsureError: null, scanned: 3, queued: 3, errors: 0 })
    mockConversationFindMany.mockResolvedValue([])
  })

  it("returns hadGmail=false when no Gmail channel is connected", async () => {
    mockChannelFindMany.mockResolvedValue([])
    const result = await runOnboardingFirstPass("tenant-1")
    expect(result.hadGmail).toBe(false)
    expect(result.organizedCount).toBe(0)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it("flags belowAutomationLevel without projecting when the level is too low", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "chan-1", tenantId: "tenant-1" }])
    mockGetAutomationLevel.mockResolvedValue(1)
    const result = await runOnboardingFirstPass("tenant-1")
    expect(result.hadGmail).toBe(true)
    expect(result.belowAutomationLevel).toBe(true)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it("aggregates the proof breakdown from gmail.labels.queued audit rows", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "chan-1", tenantId: "tenant-1" }])
    mockAuditFindMany.mockResolvedValue([
      { payloadJson: { conversationId: "c1", labels: ["Newsletter", "Read Later"] } },
      { payloadJson: { conversationId: "c2", labels: ["Newsletter"] } },
      { payloadJson: { conversationId: "c3", labels: ["Needs Reply"] } },
      // Empty label set = nothing organized; must not be counted.
      { payloadJson: { conversationId: "c4", labels: [] } },
      // Non-FlowDesk label strings are filtered out.
      { payloadJson: { conversationId: "c5", labels: ["Bogus"] } },
    ])
    mockConversationFindMany.mockResolvedValue([
      { id: "c1", contact: { name: "Morning Brew" }, messages: [{ fromE164: "hi@brew.com", subject: "Today" }] },
    ])

    const result = await runOnboardingFirstPass("tenant-1")

    expect(mockReconcile).toHaveBeenCalledWith(
      { id: "chan-1", tenantId: "tenant-1" },
      expect.objectContaining({ windowDays: expect.any(Number), batchSize: expect.any(Number) })
    )
    // c1, c2, c3 organized (c4 empty, c5 has only a non-FlowDesk label)
    expect(result.organizedCount).toBe(3)
    expect(result.byLabel).toEqual({ Newsletter: 2, "Read Later": 1, "Needs Reply": 1 })
    expect(result.samples[0]).toMatchObject({
      conversationId: "c1",
      from: "Morning Brew",
      subject: "Today",
      labels: ["Newsletter", "Read Later"],
    })
  })

  it("dedupes a conversation re-projected more than once, keeping the latest labels", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "chan-1", tenantId: "tenant-1" }])
    mockAuditFindMany.mockResolvedValue([
      { payloadJson: { conversationId: "c1", labels: ["Needs Reply"] } },
      { payloadJson: { conversationId: "c1", labels: ["Waiting On"] } },
    ])
    const result = await runOnboardingFirstPass("tenant-1")
    expect(result.organizedCount).toBe(1)
    expect(result.byLabel).toEqual({ "Waiting On": 1 })
  })

  it("falls back to a sender/subject placeholder when a sample has no contact or subject", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "chan-1", tenantId: "tenant-1" }])
    mockAuditFindMany.mockResolvedValue([
      { payloadJson: { conversationId: "c1", labels: ["Notification"] } },
    ])
    mockConversationFindMany.mockResolvedValue([
      { id: "c1", contact: null, messages: [] },
    ])
    const result = await runOnboardingFirstPass("tenant-1")
    expect(result.samples[0]).toMatchObject({
      from: "Unknown sender",
      subject: "(no subject)",
    })
  })
})
