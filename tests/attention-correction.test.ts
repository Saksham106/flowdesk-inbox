import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversationState: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
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
    mockPrisma.conversation.update.mockResolvedValue({})
    mockPrisma.conversationState.findUnique.mockResolvedValue({
      id: "cs1",
      metadataJson: { emailType: "needs_reply" },
    })
    mockPrisma.conversationState.update.mockResolvedValue({})
    mockPrisma.conversationState.upsert.mockResolvedValue({})
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("updates attentionCategory, derived state, and conversation status", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(200)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv1" },
        data: expect.objectContaining({
          status: "needs_reply",
          userState: "read_later",
          userStateSource: "user",
        }),
      })
    )
    expect(mockPrisma.conversationState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv1" },
        update: expect.objectContaining({
          state: "fyi_only",
          source: "user_override",
          metadataJson: expect.objectContaining({ attentionCategory: "read_later" }),
        }),
        create: expect.objectContaining({
          state: "fyi_only",
          source: "user_override",
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

  it("creates conversation state when none exists", async () => {
    mockPrisma.conversationState.findUnique.mockResolvedValue(null)

    const res = await PATCH(makeReq({ attentionCategory: "needs_action" }), {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockPrisma.conversationState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          conversationId: "conv1",
          state: "waiting_on_you",
          metadataJson: expect.objectContaining({ attentionCategory: "needs_action" }),
        }),
      })
    )
  })

  it("marks quiet and FYI done corrections closed", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "quiet" }), {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "closed",
          userState: "quiet",
        }),
      })
    )
  })

  it("marks waiting_on corrections in progress", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "waiting_on" }), {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "in_progress",
          userState: "waiting_on",
        }),
      })
    )
    expect(mockPrisma.conversationState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ state: "waiting_on_them" }),
        update: expect.objectContaining({ state: "waiting_on_them" }),
      })
    )
  })

  it("accepts needs_reply from the dropdown", async () => {
    const res = await PATCH(makeReq({ attentionCategory: "needs_reply" }), {
      params: { id: "conv1" },
    })

    expect(res.status).toBe(200)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "needs_reply",
          userState: "needs_reply",
        }),
      })
    )
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(makeReq({ attentionCategory: "read_later" }), {
      params: { id: "conv1" },
    })
    expect(res.status).toBe(401)
  })
})
