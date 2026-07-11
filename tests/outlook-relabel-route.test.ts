import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuditCreate,
  mockRevalidateInboxViews,
  mockRunRelabelCatchUp,
  mockAutopilotSettingFindUnique,
} = vi.hoisted(() => ({
  mockAuditCreate: vi.fn(),
  mockRevalidateInboxViews: vi.fn(),
  mockRunRelabelCatchUp: vi.fn(),
  mockAutopilotSettingFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { create: mockAuditCreate },
    autopilotSetting: { findUnique: mockAutopilotSettingFindUnique },
  },
}))

vi.mock("@/lib/agent/email-label-reconcile", () => ({
  runRelabelCatchUp: mockRunRelabelCatchUp,
  RELABEL_BATCH_SIZE: 100,
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

import { POST } from "@/app/api/connectors/outlook/relabel/route"


describe("POST /api/connectors/outlook/relabel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { tenantId: "tenant-1" } }
    mockRunRelabelCatchUp.mockResolvedValue({
      channels: 1,
      labelsEnsured: 1,
      scanned: 12,
      queued: 12,
      errors: 0,
    })
    mockAuditCreate.mockResolvedValue({})
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 3 })
  })

  it("returns 401 when unauthenticated", async () => {
    mockSession = null
    const res = await POST()
    expect(res.status).toBe(401)
    expect(mockRunRelabelCatchUp).not.toHaveBeenCalled()
  })

  it("returns 404 when the tenant has no connected Outlook account", async () => {
    mockRunRelabelCatchUp.mockResolvedValue({
      channels: 0,
      labelsEnsured: 0,
      scanned: 0,
      queued: 0,
      errors: 0,
    })
    const res = await POST()
    expect(res.status).toBe(404)
  })

  it("reconciles labels for every connected Outlook channel scoped to the caller's tenant", async () => {
    const res = await POST()
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
    expect(mockRunRelabelCatchUp).toHaveBeenCalledWith({ tenantId: "tenant-1", provider: "microsoft" })
    expect(mockRevalidateInboxViews).toHaveBeenCalledWith("tenant-1")
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "outlook.labels.relabel_requested" }),
      })
    )
  })

  it("reports belowAutomationLevel instead of a misleading 'already up to date' when the level gate is the real blocker", async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 1 })
    mockRunRelabelCatchUp.mockResolvedValue({
      channels: 1,
      labelsEnsured: 0,
      scanned: 5,
      queued: 0,
      errors: 0,
    })

    const res = await POST()
    const body = await res.json()

    expect(body.automationLevel).toBe(1)
    expect(body.belowAutomationLevel).toBe(true)
    expect(body.minAutomationLevel).toBe(2)
  })

  it("reports hasMore when the batch came back full, so the client knows to prompt another click", async () => {
    mockRunRelabelCatchUp.mockResolvedValue({
      channels: 1,
      labelsEnsured: 1,
      scanned: 100,
      queued: 100,
      errors: 0,
    })
    const res = await POST()
    const body = await res.json()
    expect(body.hasMore).toBe(true)
  })
})
