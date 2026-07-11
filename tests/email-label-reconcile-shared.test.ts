import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockConversationFindMany, mockChannelFindMany, mockGetWritebackAdapter, mockProjectLabels } =
  vi.hoisted(() => ({
    mockConversationFindMany: vi.fn(),
    mockChannelFindMany: vi.fn(),
    mockGetWritebackAdapter: vi.fn(),
    mockProjectLabels: vi.fn(),
  }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: mockConversationFindMany },
    channel: { findMany: mockChannelFindMany },
  },
}))

vi.mock("@/lib/email/writeback-adapter", () => ({
  getWritebackAdapter: mockGetWritebackAdapter,
}))

vi.mock("@/lib/email-labels", () => ({
  projectFlowDeskLabelsForConversation: mockProjectLabels,
}))

import { reconcileLabelsForChannel, runRelabelCatchUp } from "@/lib/agent/email-label-reconcile"

const GOOGLE_CHANNEL = { id: "channel-1", tenantId: "tenant-1", provider: "google" }
const MICROSOFT_CHANNEL = { id: "channel-2", tenantId: "tenant-1", provider: "microsoft" }

describe("reconcileLabelsForChannel", () => {
  let mockEnsureLabels: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureLabels = vi.fn().mockResolvedValue(undefined)
    mockGetWritebackAdapter.mockImplementation((provider: string) =>
      provider === "google" || provider === "microsoft" ? { ensureLabels: mockEnsureLabels } : null
    )
    mockConversationFindMany.mockResolvedValue([{ id: "conv-1" }, { id: "conv-2" }])
    mockProjectLabels.mockResolvedValue({ id: "job-1" })
  })

  it("ensures labels, scopes the conversation query to the channel, and re-projects each one", async () => {
    const result = await reconcileLabelsForChannel(GOOGLE_CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result).toEqual({
      labelsEnsured: true,
      labelsEnsureError: null,
      scanned: 2,
      queued: 2,
      errors: 0,
    })
    expect(mockGetWritebackAdapter).toHaveBeenCalledWith("google")
    expect(mockEnsureLabels).toHaveBeenCalledWith("channel-1")
    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channelId: "channel-1",
          externalThreadId: { not: "" },
          lastMessageAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
        take: 10,
      })
    )
    expect(mockProjectLabels).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conv-1",
    })
    expect(mockProjectLabels).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conv-2",
    })
  })

  it("uses the microsoft writeback adapter to ensure labels for a microsoft channel", async () => {
    const result = await reconcileLabelsForChannel(MICROSOFT_CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result.labelsEnsured).toBe(true)
    expect(mockGetWritebackAdapter).toHaveBeenCalledWith("microsoft")
    expect(mockEnsureLabels).toHaveBeenCalledWith("channel-2")
  })

  it("still re-projects conversations even when ensuring/coloring labels fails", async () => {
    // Coloring is cosmetic; whether a thread actually gets labeled must not
    // depend on the color call succeeding (this is the whole point of the fix).
    mockEnsureLabels.mockRejectedValue(new Error("insufficient scopes"))

    const result = await reconcileLabelsForChannel(GOOGLE_CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result.labelsEnsured).toBe(false)
    expect(result.labelsEnsureError).toBe("insufficient scopes")
    expect(result.queued).toBe(2)
    expect(mockProjectLabels).toHaveBeenCalledTimes(2)
  })

  it("does not count a skipped projection (e.g. below automation level) as queued", async () => {
    mockProjectLabels.mockResolvedValue(null)
    const result = await reconcileLabelsForChannel(GOOGLE_CHANNEL, { windowDays: 30, batchSize: 10 })
    expect(result.queued).toBe(0)
    expect(result.errors).toBe(0)
  })

  it("counts a projection failure as an error without stopping the rest of the batch", async () => {
    mockProjectLabels
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "job-2" })

    const result = await reconcileLabelsForChannel(GOOGLE_CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result.errors).toBe(1)
    expect(result.queued).toBe(1)
  })
})

describe("runRelabelCatchUp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWritebackAdapter.mockImplementation((provider: string) =>
      provider === "google" || provider === "microsoft"
        ? { ensureLabels: vi.fn().mockResolvedValue(undefined) }
        : null
    )
    mockConversationFindMany.mockResolvedValue([{ id: "conv-1" }])
    mockProjectLabels.mockResolvedValue({ id: "job-1" })
  })

  it("scopes the channel lookup to the tenant, the google provider, and a non-null gmail credential", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "channel-1", tenantId: "tenant-1", provider: "google" }])

    const result = await runRelabelCatchUp({ tenantId: "tenant-1", provider: "google" })

    expect(mockChannelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          provider: "google",
          gmailCredential: { isNot: null },
        }),
      })
    )
    expect(result).toEqual({ channels: 1, labelsEnsured: 1, scanned: 1, queued: 1, errors: 0 })
  })

  it("scopes the channel lookup to the microsoft provider and a non-null outlook credential", async () => {
    mockChannelFindMany.mockResolvedValue([{ id: "channel-2", tenantId: "tenant-1", provider: "microsoft" }])

    const result = await runRelabelCatchUp({ tenantId: "tenant-1", provider: "microsoft" })

    expect(mockChannelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          provider: "microsoft",
          outlookCredential: { isNot: null },
        }),
      })
    )
    expect(result).toEqual({ channels: 1, labelsEnsured: 1, scanned: 1, queued: 1, errors: 0 })
  })

  it("returns a zero-channel result when the tenant has no connected channel of that provider", async () => {
    mockChannelFindMany.mockResolvedValue([])

    const result = await runRelabelCatchUp({ tenantId: "tenant-1", provider: "google" })

    expect(result).toEqual({ channels: 0, labelsEnsured: 0, scanned: 0, queued: 0, errors: 0 })
    expect(mockConversationFindMany).not.toHaveBeenCalled()
  })
})
