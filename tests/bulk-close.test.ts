import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversationState: {
      findMany: vi.fn(),
    },
    conversation: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { POST } from "@/app/api/conversations/bulk-close/route"

describe("POST /api/conversations/bulk-close", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversationState.findMany.mockResolvedValue([
      { conversationId: "c1" },
      { conversationId: "c2" },
    ])
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("closes all FYI/quiet conversations and returns count", async () => {
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.closed).toBe(2)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "closed" },
      })
    )
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(401)
  })
})
