import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockLabelMappingFindMany,
  mockLabelMappingUpsert,
  mockAuditCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockLabelMappingFindMany: vi.fn(),
  mockLabelMappingUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailLabelMapping: {
      findMany: mockLabelMappingFindMany,
      upsert: mockLabelMappingUpsert,
    },
    auditLog: { create: mockAuditCreate },
    $transaction: mockTransaction,
  },
}))

let mockSession: unknown = null
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { GET, PATCH } from "@/app/api/gmail-label-settings/route"
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels"

function makeReq(body: Record<string, unknown>): Request {
  return { json: async () => body } as unknown as Request
}

describe("GET /api/gmail-label-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { tenantId: "tenant-1" } }
  })

  it("returns 401 without a session", async () => {
    mockSession = null
    const res = (await GET()) as unknown as { status: number }
    expect(res.status).toBe(401)
  })

  it("returns all canonical labels, defaulting missing ones to enabled", async () => {
    mockLabelMappingFindMany.mockResolvedValue([
      { canonical: "FlowDesk/Low Priority", enabled: false },
    ])
    const res = (await GET()) as unknown as {
      body: { labels: Array<{ canonical: string; enabled: boolean }> }
    }
    expect(res.body.labels.map((label) => label.canonical)).toEqual([
      ...FLOWDESK_GMAIL_LABEL_NAMES,
    ])
    const lowPriority = res.body.labels.find(
      (l) => l.canonical === "FlowDesk/Low Priority"
    )
    const needsReply = res.body.labels.find(
      (l) => l.canonical === "FlowDesk/Needs Reply"
    )
    expect(lowPriority?.enabled).toBe(false)
    expect(needsReply?.enabled).toBe(true)
  })
})

describe("PATCH /api/gmail-label-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { tenantId: "tenant-1" } }
    mockTransaction.mockResolvedValue([{}, {}])
  })

  it("rejects an unknown label", async () => {
    const res = (await PATCH(
      makeReq({ canonical: "FlowDesk/Nope", enabled: false })
    )) as unknown as { status: number }
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects a non-boolean enabled", async () => {
    const res = (await PATCH(
      makeReq({ canonical: "FlowDesk/Needs Reply", enabled: "yes" })
    )) as unknown as { status: number }
    expect(res.status).toBe(400)
  })

  it("upserts the mapping and writes an audit event", async () => {
    const res = (await PATCH(
      makeReq({ canonical: "FlowDesk/Low Priority", enabled: false })
    )) as unknown as { status: number; body: { ok: boolean } }
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockLabelMappingUpsert).toHaveBeenCalledWith({
      where: {
        tenantId_canonical: {
          tenantId: "tenant-1",
          canonical: "FlowDesk/Low Priority",
        },
      },
      create: {
        tenantId: "tenant-1",
        canonical: "FlowDesk/Low Priority",
        enabled: false,
      },
      update: { enabled: false },
    })
    expect(mockAuditCreate).toHaveBeenCalled()
  })
})
