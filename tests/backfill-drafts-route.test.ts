import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetServerSession, mockFindMany, mockProposeDraft, mockGetAutomationLevel } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockFindMany: vi.fn(),
  mockProposeDraft: vi.fn(),
  mockGetAutomationLevel: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { conversation: { findMany: mockFindMany } } }))
vi.mock("@/lib/agent/draft-generation", () => ({ proposeDraftForConversation: mockProposeDraft }))
vi.mock("@/lib/agent/automation-level", () => ({ getAutomationLevel: mockGetAutomationLevel }))

const { POST } = await import("@/app/api/autopilot-settings/backfill-drafts/route")

describe("POST /api/autopilot-settings/backfill-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1", id: "u1", email: "a@b.com" } })
    mockGetAutomationLevel.mockResolvedValue(3)
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "all" }) }))
    expect(res.status).toBe(401)
  })

  it("returns 403 when automation level is below 3", async () => {
    mockGetAutomationLevel.mockResolvedValue(2)
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "all" }) }))
    expect(res.status).toBe(403)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("proposes a draft for each needs_reply conversation without an existing draft, scope all", async () => {
    mockFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }])
    mockProposeDraft
      .mockResolvedValueOnce({ status: "drafted", draftId: "d1" })
      .mockResolvedValueOnce({ status: "gated_out", reason: "newsletter" })

    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "all" }) }))
    const data = await res.json()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "t1", status: "needs_reply", draft: null }),
      })
    )
    expect(mockProposeDraft).toHaveBeenCalledTimes(2)
    expect(mockProposeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", source: "backfill" })
    )
    expect(data.results).toEqual([
      { conversationId: "c1", status: "drafted" },
      { conversationId: "c2", status: "gated_out" },
    ])
  })

  it("caps to 10 conversations for scope last_n with n=10", async () => {
    mockFindMany.mockResolvedValue([])
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "last_n", n: 10 }) }))
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))
  })

  it("caps requests at 50 conversations regardless of requested n", async () => {
    mockFindMany.mockResolvedValue([])
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "last_n", n: 500 }) }))
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
  })

  it("rejects an invalid scope", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ scope: "bogus" }) }))
    expect(res.status).toBe(400)
  })
})
