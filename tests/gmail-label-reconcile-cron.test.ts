import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockChannelFindMany,
  mockConversationFindMany,
  mockAuditCreate,
  mockEnsureFlowDeskLabels,
  mockProjectLabels,
} = vi.hoisted(() => ({
  mockChannelFindMany: vi.fn(),
  mockConversationFindMany: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockEnsureFlowDeskLabels: vi.fn(),
  mockProjectLabels: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findMany: mockChannelFindMany },
    conversation: { findMany: mockConversationFindMany },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
  ensureFlowDeskLabels: mockEnsureFlowDeskLabels,
}))

vi.mock("@/lib/gmail-labels", () => ({
  projectFlowDeskLabelsForConversation: mockProjectLabels,
}))

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    headers: Record<string, string>
    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body
      this.status = init?.status ?? 200
      this.headers = init?.headers ?? {}
    }
    async json() { return this.body }
    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { GET } from "@/app/api/cron/gmail-label-reconcile/route"

function request(auth?: string) {
  return {
    headers: new Headers(auth ? { authorization: auth } : {}),
  } as Request
}

describe("GET /api/cron/gmail-label-reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockChannelFindMany.mockResolvedValue([{ id: "channel-1", tenantId: "tenant-1" }])
    mockConversationFindMany.mockResolvedValue([
      { id: "conv-1", tenantId: "tenant-1" },
      { id: "conv-2", tenantId: "tenant-1" },
    ])
    mockEnsureFlowDeskLabels.mockResolvedValue(undefined)
    mockProjectLabels.mockResolvedValue({ id: "job-1" })
    mockAuditCreate.mockResolvedValue({})
  })

  it("rejects requests without the cron secret", async () => {
    const res = await GET(request())
    expect(res.status).toBe(401)
  })

  it("rejects Bearer undefined when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(request("Bearer undefined"))
    expect(res.status).toBe(401)
  })

  it("ensures labels per Gmail channel and re-projects a bounded recent batch", async () => {
    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ channels: 1, labelsEnsured: 1, scanned: 2, queued: 2, errors: 0 })
    expect(mockEnsureFlowDeskLabels).toHaveBeenCalledWith("channel-1")
    expect(mockProjectLabels).toHaveBeenCalledTimes(2)
    // Scoped to this specific channel (not a global cross-tenant query) so one
    // very active tenant can't consume every other tenant's batch slice.
    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channelId: "channel-1",
          externalThreadId: { not: "" },
        }),
        take: expect.any(Number),
      })
    )
  })

  it("batches per channel so one tenant's conversations can't crowd out another's", async () => {
    // Regression: the batch used to be a single global take(50) across every
    // tenant's conversations pooled together, so one very active tenant could
    // consume the whole run's budget and starve everyone else. Each channel
    // now gets its own bounded batch.
    mockChannelFindMany.mockResolvedValue([
      { id: "channel-1", tenantId: "tenant-1" },
      { id: "channel-2", tenantId: "tenant-2" },
    ])
    mockConversationFindMany.mockResolvedValue([{ id: "conv-1" }])

    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ channels: 2, labelsEnsured: 2, scanned: 2, queued: 2, errors: 0 })
    expect(mockConversationFindMany).toHaveBeenCalledTimes(2)
    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ channelId: "channel-1" }) })
    )
    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ channelId: "channel-2" }) })
    )
  })

  it("does not count skipped projections (below level, non-Gmail) as queued", async () => {
    mockProjectLabels.mockResolvedValue(null)
    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()
    expect(body.queued).toBe(0)
    expect(body.errors).toBe(0)
  })

  it("records ensure failures per channel and returns 500 with the error header", async () => {
    mockEnsureFlowDeskLabels.mockRejectedValue(new Error("insufficient scopes"))
    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()

    expect(res.status).toBe(500)
    const headers = res.headers as unknown as Record<string, string>
    expect(headers["X-Gmail-Label-Reconcile-Errors"]).toBe("1")
    expect(body.labelsEnsured).toBe(0)
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "gmail.labels.ensure_failed",
        payloadJson: expect.objectContaining({ error: "insufficient scopes" }),
      }),
    })
    // A failing channel must not stop conversation re-projection
    expect(mockProjectLabels).toHaveBeenCalledTimes(2)
  })

  it("keeps processing when a single projection fails", async () => {
    mockProjectLabels
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "job-2" })
    const res = await GET(request("Bearer cron-secret"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.queued).toBe(1)
    expect(body.errors).toBe(1)
  })
})
