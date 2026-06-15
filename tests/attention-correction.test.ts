import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversationState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
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

import { PATCH } from "@/app/api/conversations/[id]/attention/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/conversations/conv1/attention", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/conversations/[id]/attention", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv1", tenantId: "t1" })
    mockPrisma.conversationState.findUnique.mockResolvedValue({
      id: "cs1",
      metadataJson: { emailType: "needs_reply" },
    })
    mockPrisma.conversationState.update.mockResolvedValue({})
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("updates attentionCategory in metadataJson", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(200)
    expect(mockPrisma.conversationState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({ attentionCategory: "read_later" }),
        }),
      })
    )
  })

  it("rejects invalid attentionCategory", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "not_valid" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(401)
  })
})
