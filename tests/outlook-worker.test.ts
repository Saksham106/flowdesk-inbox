import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  eventUpdateMany: vi.fn(),
  credentialFindMany: vi.fn(),
  runDelta: vi.fn(),
  ensureSubscription: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outlookSyncEvent: {
      findMany: mocks.eventFindMany,
      updateMany: mocks.eventUpdateMany,
    },
    outlookCredential: { findMany: mocks.credentialFindMany },
  },
}))
vi.mock("@/lib/outlook-sync", () => ({ runOutlookDeltaSync: mocks.runDelta }))
vi.mock("@/lib/outlook-subscriptions", () => ({
  ensureOutlookSubscription: mocks.ensureSubscription,
}))

import { processOutlookSyncWork } from "@/lib/outlook-worker"

describe("processOutlookSyncWork", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.eventFindMany.mockResolvedValue([])
    mocks.eventUpdateMany.mockResolvedValue({ count: 1 })
    mocks.credentialFindMany.mockResolvedValue([])
    mocks.runDelta.mockResolvedValue({ ok: true, synced: 1, deleted: 0, hasMore: false })
    mocks.ensureSubscription.mockResolvedValue({ ok: true, renewed: false })
  })

  it("atomically claims and completes a durable notification event", async () => {
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-1", channelId: "channel-1", tenantId: "tenant-1", status: "pending" },
    ])

    const result = await processOutlookSyncWork()

    expect(mocks.eventUpdateMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ id: "event-1" }),
      data: expect.objectContaining({ status: "processing", attempts: { increment: 1 } }),
    }))
    expect(mocks.runDelta).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "webhook",
    }))
    expect(mocks.eventUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", processedAt: expect.any(Date) }),
    }))
    expect(result.completedEvents).toBe(1)
  })

  it("does not process an event another worker already claimed", async () => {
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-1", channelId: "channel-1", tenantId: "tenant-1", status: "pending" },
    ])
    mocks.eventUpdateMany.mockResolvedValueOnce({ count: 0 })
    await processOutlookSyncWork()
    expect(mocks.runDelta).not.toHaveBeenCalled()
  })

  it("reschedules busy and partial delta work without looping", async () => {
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-1", channelId: "channel-1", tenantId: "tenant-1", status: "pending" },
    ])
    mocks.runDelta.mockResolvedValueOnce({ ok: true, skipped: "sync_in_progress" })
    await processOutlookSyncWork()
    expect(mocks.eventUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "pending", nextAttemptAt: expect.any(Date) }),
    }))

    vi.clearAllMocks()
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-2", channelId: "channel-2", tenantId: "tenant-2", status: "pending" },
    ])
    mocks.eventUpdateMany.mockResolvedValue({ count: 1 })
    mocks.credentialFindMany.mockResolvedValue([])
    mocks.runDelta.mockResolvedValueOnce({ ok: true, hasMore: true })
    await processOutlookSyncWork()
    expect(mocks.eventUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "pending" }),
    }))
  })

  it("bounds fallback sync and subscription renewal queries", async () => {
    await processOutlookSyncWork()
    expect(mocks.eventFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }))
    expect(mocks.credentialFindMany).toHaveBeenCalledTimes(2)
    for (const call of mocks.credentialFindMany.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ take: 25 }))
    }
  })
})
