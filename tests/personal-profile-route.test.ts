import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockFindUnique, mockUpsert, mockAuditCreate, mockTransaction } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    writingPreference: { findUnique: mockFindUnique, upsert: mockUpsert },
    auditLog: { create: mockAuditCreate },
    $transaction: mockTransaction,
  },
}))

let mockSession: unknown = null
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => mockSession) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200 }
    async json() { return this.body }
    static json(body: unknown, init?: { status?: number }) { return new NextResponse(body, init) }
  }
  return { NextResponse }
})

import { GET, PATCH } from "@/app/api/writing-preferences/route"

function request(body: unknown): Request {
  return { json: async () => body } as Request
}

describe("writing preferences API", () => {
  beforeEach(() => vi.clearAllMocks())

  it("scopes GET to the authenticated tenant", async () => {
    mockSession = { user: { id: "user-1", tenantId: "tenant-A" } }
    mockFindUnique.mockResolvedValue(null)

    await GET()

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantId: "tenant-A" } })
  })

  it("rejects oversized preference arrays", async () => {
    mockSession = { user: { id: "user-1", tenantId: "tenant-A" } }

    const response = await PATCH(request({ preferredGreetings: Array.from({ length: 21 }, () => "Hi") }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "preferredGreetings must contain at most 20 items" })
  })

  it("upserts allowed preferences for the authenticated tenant only", async () => {
    mockSession = { user: { id: "user-1", tenantId: "tenant-A" } }
    mockUpsert.mockResolvedValue({ id: "wp-1", tenantId: "tenant-A", forbidEmDash: true })
    mockAuditCreate.mockResolvedValue({})

    await PATCH(request({ tenantId: "tenant-B", forbidEmDash: true, preferredGreetings: ["Hello"] }))

    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-A" },
      create: expect.objectContaining({ tenantId: "tenant-A", forbidEmDash: true, preferredGreetings: ["Hello"] }),
    }))
  })
})
