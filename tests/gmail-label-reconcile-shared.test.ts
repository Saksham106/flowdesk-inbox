import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockConversationFindMany, mockEnsureFlowDeskLabels, mockProjectLabels } = vi.hoisted(() => ({
  mockConversationFindMany: vi.fn(),
  mockEnsureFlowDeskLabels: vi.fn(),
  mockProjectLabels: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: mockConversationFindMany },
  },
}))

vi.mock("@/lib/google", () => ({
  ensureFlowDeskLabels: mockEnsureFlowDeskLabels,
}))

vi.mock("@/lib/email-labels", () => ({
  projectFlowDeskLabelsForConversation: mockProjectLabels,
}))

import { reconcileGmailLabelsForChannel } from "@/lib/agent/gmail-label-reconcile"

const CHANNEL = { id: "channel-1", tenantId: "tenant-1" }

describe("reconcileGmailLabelsForChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureFlowDeskLabels.mockResolvedValue(undefined)
    mockConversationFindMany.mockResolvedValue([{ id: "conv-1" }, { id: "conv-2" }])
    mockProjectLabels.mockResolvedValue({ id: "job-1" })
  })

  it("ensures labels, scopes the conversation query to the channel, and re-projects each one", async () => {
    const result = await reconcileGmailLabelsForChannel(CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result).toEqual({
      labelsEnsured: true,
      labelsEnsureError: null,
      scanned: 2,
      queued: 2,
      errors: 0,
    })
    expect(mockEnsureFlowDeskLabels).toHaveBeenCalledWith("channel-1")
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

  it("still re-projects conversations even when ensuring/coloring labels fails", async () => {
    // Coloring is cosmetic; whether a thread actually gets labeled must not
    // depend on the color call succeeding (this is the whole point of the fix).
    mockEnsureFlowDeskLabels.mockRejectedValue(new Error("insufficient scopes"))

    const result = await reconcileGmailLabelsForChannel(CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result.labelsEnsured).toBe(false)
    expect(result.labelsEnsureError).toBe("insufficient scopes")
    expect(result.queued).toBe(2)
    expect(mockProjectLabels).toHaveBeenCalledTimes(2)
  })

  it("does not count a skipped projection (e.g. below automation level) as queued", async () => {
    mockProjectLabels.mockResolvedValue(null)
    const result = await reconcileGmailLabelsForChannel(CHANNEL, { windowDays: 30, batchSize: 10 })
    expect(result.queued).toBe(0)
    expect(result.errors).toBe(0)
  })

  it("counts a projection failure as an error without stopping the rest of the batch", async () => {
    mockProjectLabels
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "job-2" })

    const result = await reconcileGmailLabelsForChannel(CHANNEL, { windowDays: 30, batchSize: 10 })

    expect(result.errors).toBe(1)
    expect(result.queued).toBe(1)
  })
})
