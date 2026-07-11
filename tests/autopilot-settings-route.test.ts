import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetServerSession,
  mockFindUnique,
  mockUpsert,
  mockAuditCreate,
  mockConversationCount,
  mockTransaction,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockConversationCount: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    autopilotSetting: { findUnique: mockFindUnique, upsert: mockUpsert },
    auditLog: { create: mockAuditCreate },
    conversation: { count: mockConversationCount },
    $transaction: mockTransaction,
  },
}))

const { PATCH } = await import("@/app/api/autopilot-settings/route")

describe("PATCH /api/autopilot-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1", id: "u1", email: "a@b.com" } })
    mockUpsert.mockResolvedValue({ automationLevel: 3 })
    mockAuditCreate.mockResolvedValue({})
    // Mirror the route's usage: $transaction is called with an array of
    // already-invoked prisma promises, so resolve them in order.
    mockTransaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }))
    expect(res.status).toBe(401)
  })

  it("rejects an out-of-range automationLevel", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ automationLevel: 9 }) }))
    expect(res.status).toBe(400)
  })

  describe("backfill signal", () => {
    it("includes backfillAvailable and an eligible count when crossing from below 3 to 3+", async () => {
      mockFindUnique.mockResolvedValue({ automationLevel: 2 })
      mockUpsert.mockResolvedValue({ automationLevel: 3 })
      mockConversationCount.mockResolvedValue(4)

      const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ automationLevel: 3 }) }))
      const data = await res.json()

      expect(data.backfillAvailable).toBe(true)
      expect(data.backfillEligibleCount).toBe(4)
    })

    it("omits backfillAvailable when already at level 3+", async () => {
      mockFindUnique.mockResolvedValue({ automationLevel: 4 })
      mockUpsert.mockResolvedValue({ automationLevel: 5 })

      const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ automationLevel: 5 }) }))
      const data = await res.json()

      expect(data.backfillAvailable).toBeUndefined()
      expect(mockConversationCount).not.toHaveBeenCalled()
    })

    it("omits backfillAvailable when automationLevel is not part of the patch", async () => {
      mockFindUnique.mockResolvedValue({ automationLevel: 2 })

      const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }))
      const data = await res.json()

      expect(data.backfillAvailable).toBeUndefined()
      expect(mockConversationCount).not.toHaveBeenCalled()
    })
  })
})
