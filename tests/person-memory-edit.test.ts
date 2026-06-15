import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockPrisma, mockGetServerSession } = vi.hoisted(() => {
  const mockPrisma = {
    personMemory: { findFirst: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  const mockGetServerSession = vi.fn()
  return { mockPrisma, mockGetServerSession }
})

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { PATCH } from "@/app/api/person-memory/[contactId]/route"
import { NextRequest } from "next/server"

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/person-memory/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/person-memory/[contactId]", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetServerSession.mockResolvedValue({ user: { tenantId: "t1" } })
    mockPrisma.personMemory.findFirst.mockResolvedValue({ id: "pm1", tenantId: "t1" })
    mockPrisma.personMemory.update.mockResolvedValue({})
    mockPrisma.auditLog.create.mockResolvedValue({})
  })

  it("updates summary and preferences", async () => {
    const res = await PATCH(makeReq({ summary: "Updated summary", preferences: "Prefers short replies" }), {
      params: { contactId: "c1" },
    })
    expect(res.status).toBe(200)
    expect(mockPrisma.personMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: "Updated summary",
          preferences: "Prefers short replies",
        }),
      })
    )
  })

  it("returns 404 when no memory exists", async () => {
    mockPrisma.personMemory.findFirst.mockResolvedValue(null)
    const res = await PATCH(makeReq({ summary: "x" }), { params: { contactId: "c1" } })
    expect(res.status).toBe(404)
  })

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null)
    const res = await PATCH(makeReq({ summary: "x" }), { params: { contactId: "c1" } })
    expect(res.status).toBe(401)
  })
})
