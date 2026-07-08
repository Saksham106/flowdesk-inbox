import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockChannelFindMany,
  mockAuditCreate,
  mockRevalidateInboxViews,
  mockReconcile,
  mockAutopilotSettingFindUnique,
} = vi.hoisted(() => ({
  mockChannelFindMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockRevalidateInboxViews: vi.fn(),
  mockReconcile: vi.fn(),
  mockAutopilotSettingFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findMany: mockChannelFindMany },
    auditLog: { create: mockAuditCreate },
    autopilotSetting: { findUnique: mockAutopilotSettingFindUnique },
  },
}))

vi.mock("@/lib/agent/gmail-label-reconcile", () => ({
  reconcileGmailLabelsForChannel: mockReconcile,
}))

vi.mock("@/lib/cache-tags", () => ({
  revalidateInboxViews: mockRevalidateInboxViews,
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

import { POST } from "@/app/api/connectors/gmail/relabel/route"

function postRequest(body: unknown = {}) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request
}

describe("POST /api/connectors/gmail/relabel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { tenantId: "tenant-1" } }
    mockChannelFindMany.mockResolvedValue([{ id: "channel-1", tenantId: "tenant-1" }])
    mockReconcile.mockResolvedValue({
      labelsEnsured: true,
      labelsEnsureError: null,
      scanned: 12,
      queued: 12,
      errors: 0,
    })
    mockAuditCreate.mockResolvedValue({})
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 3 })
  })

  it("returns 401 when unauthenticated", async () => {
    mockSession = null
    const res = await POST(postRequest())
    expect(res.status).toBe(401)
  })

  it("returns 404 when the tenant has no connected Gmail account", async () => {
    mockChannelFindMany.mockResolvedValue([])
    const res = await POST(postRequest())
    expect(res.status).toBe(404)
  })

  it("reconciles labels for every connected Gmail channel scoped to the caller's tenant", async () => {
    const res = await POST(postRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      channels: 1,
      labelsEnsured: 1,
      scanned: 12,
      queued: 12,
      errors: 0,
      hasMore: false,
      automationLevel: 3,
      belowAutomationLevel: false,
      minAutomationLevel: 2,
    })
    expect(mockChannelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1", provider: "google" }),
      })
    )
    expect(mockReconcile).toHaveBeenCalledWith(
      { id: "channel-1", tenantId: "tenant-1" },
      expect.objectContaining({ windowDays: expect.any(Number), batchSize: expect.any(Number) })
    )
    expect(mockRevalidateInboxViews).toHaveBeenCalledWith("tenant-1")
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gmail.labels.relabel_requested" }),
      })
    )
  })

  it("reports belowAutomationLevel instead of a misleading 'already up to date' when the level gate is the real blocker", async () => {
    // Regression: queued=0 was indistinguishable between "genuinely nothing to
    // fix" and "automation level silently blocked every conversation" — the
    // client can now tell these apart and point the user at the real fix.
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 1 })
    mockReconcile.mockResolvedValue({
      labelsEnsured: false,
      labelsEnsureError: null,
      scanned: 5,
      queued: 0,
      errors: 0,
    })

    const res = await POST(postRequest())
    const body = await res.json()

    expect(body.automationLevel).toBe(1)
    expect(body.belowAutomationLevel).toBe(true)
    expect(body.minAutomationLevel).toBe(2)
  })

  it("reports hasMore when the batch came back full, so the client knows to prompt another click", async () => {
    mockReconcile.mockResolvedValue({
      labelsEnsured: true,
      labelsEnsureError: null,
      scanned: 100,
      queued: 100,
      errors: 0,
    })
    const res = await POST(postRequest())
    const body = await res.json()
    expect(body.hasMore).toBe(true)
  })

  it("does not leak another tenant's channel even if a channelId is guessed", async () => {
    await POST(postRequest({ channelId: "someone-elses-channel" }))
    expect(mockChannelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1", id: "someone-elses-channel" }),
      })
    )
  })
})
