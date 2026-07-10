import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSession = { user: { id: "u1", tenantId: "t1", email: "u@example.com" } }
const mockFindFirst = vi.fn()
const mockConversationUpdate = vi.fn()
const mockUpsert = vi.fn()
const mockAuditCreate = vi.fn()
const mockCorrectionCreate = vi.fn()
const mockQueue = vi.fn()

vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockFindFirst, update: mockConversationUpdate },
    conversationState: { findUnique: vi.fn(), upsert: mockUpsert },
    auditLog: { create: mockAuditCreate },
    classificationCorrection: { create: mockCorrectionCreate },
  },
}))
vi.mock("@/lib/gmail-labels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gmail-labels")>("@/lib/gmail-labels")
  return { ...actual, queueFlowDeskLabelWriteback: mockQueue }
})
vi.mock("@/lib/cache-tags", () => ({ revalidateInboxViews: vi.fn() }))

describe("PATCH /flowdesk-label", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue({
      id: "c1",
      tenantId: "t1",
      channelId: "ch1",
      externalThreadId: "thread1",
      status: "needs_reply",
      userState: null,
      contact: { phoneE164: "sender@example.com" },
      draft: null,
      stateRecord: null,
      channel: { provider: "google" },
    })
  })

  it("sets Newsletter as a content label and records learning", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Newsletter" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        emailType: "newsletter",
      }),
    }))
    expect(mockAuditCreate).toHaveBeenCalled()
    expect(mockCorrectionCreate).toHaveBeenCalled()
    expect(mockQueue).toHaveBeenCalled()
  })

  it("rejects a non-canonical label", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "NotARealLabel" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(400)
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    const nextAuth = await import("next-auth")
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce(null as never)

    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Needs Reply" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(401)
  })

  it("rejects manually setting Autodrafted when no draft is proposed or approved", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Autodrafted" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(400)
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it("allows Autodrafted when an existing draft is proposed", async () => {
    mockFindFirst.mockResolvedValue({
      id: "c1",
      tenantId: "t1",
      channelId: "ch1",
      externalThreadId: "thread1",
      status: "needs_reply",
      userState: null,
      contact: { phoneE164: "sender@example.com" },
      draft: { status: "proposed" },
      stateRecord: null,
      channel: { provider: "google" },
    })

    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Autodrafted" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(200)
    expect(mockConversationUpdate).toHaveBeenCalled()
  })

  it("records five side effects for a workflow label like Waiting On", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/flowdesk-label/route")
    const res = await PATCH(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ label: "Waiting On" }),
    }), { params: { id: "c1" } })

    expect(res.status).toBe(200)
    expect(mockConversationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "c1" },
      data: expect.objectContaining({
        status: "in_progress",
        userState: "waiting_on",
      }),
    }))
    expect(mockUpsert).toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalled()
    expect(mockCorrectionCreate).toHaveBeenCalled()
    expect(mockQueue).toHaveBeenCalled()
  })
})
