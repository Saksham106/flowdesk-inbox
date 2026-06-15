import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    conversation: { findFirst: vi.fn() },
    inboxTask: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { POST } from "@/app/api/tasks/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/tasks", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv1", tenantId: "t1" })
    mockPrisma.inboxTask.create.mockResolvedValue({ id: "task1", title: "Send proposal" })
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("creates a task with source manual", async () => {
    const res = await POST(makeReq({ conversationId: "conv1", title: "Send proposal", dueAt: null }))
    expect(res.status).toBe(201)
    expect(mockPrisma.inboxTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Send proposal",
          source: "manual",
          tenantId: "t1",
        }),
      })
    )
  })

  it("rejects empty title", async () => {
    const res = await POST(makeReq({ conversationId: "conv1", title: "", dueAt: null }))
    expect(res.status).toBe(400)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await POST(makeReq({ conversationId: "conv1", title: "Task", dueAt: null }))
    expect(res.status).toBe(401)
  })
})
