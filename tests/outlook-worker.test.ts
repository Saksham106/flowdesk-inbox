import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  eventUpdateMany: vi.fn(),
  credentialFindMany: vi.fn(),
  credentialUpdate: vi.fn(),
  auditCreate: vi.fn(),
  runDelta: vi.fn(),
  ensureSubscription: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outlookSyncEvent: {
      findMany: mocks.eventFindMany,
      updateMany: mocks.eventUpdateMany,
    },
    outlookCredential: { findMany: mocks.credentialFindMany, update: mocks.credentialUpdate },
    auditLog: { create: mocks.auditCreate },
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
    mocks.credentialUpdate.mockResolvedValue({})
    mocks.auditCreate.mockResolvedValue({})
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

  it("records the renewal failure cause and keeps processing the next credential", async () => {
    mocks.credentialFindMany
      .mockResolvedValueOnce([
        { channelId: "chan-r1", channel: { tenantId: "tenant-r1" } },
        { channelId: "chan-r2", channel: { tenantId: "tenant-r2" } },
      ])
      .mockResolvedValueOnce([])
    mocks.ensureSubscription
      .mockRejectedValueOnce(new Error("renewal boom"))
      .mockResolvedValueOnce({ ok: true, renewed: true })

    const result = await processOutlookSyncWork()

    expect(mocks.ensureSubscription).toHaveBeenCalledTimes(2)
    expect(mocks.ensureSubscription).toHaveBeenNthCalledWith(1, "chan-r1")
    expect(mocks.ensureSubscription).toHaveBeenNthCalledWith(2, "chan-r2")
    expect(mocks.credentialUpdate).toHaveBeenCalledWith({
      where: { channelId: "chan-r1" },
      data: {
        subscriptionError: "renewal boom",
        subscriptionLastRenewalAttempt: expect.any(Date),
      },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-r1",
        action: "outlook.subscription.renewal_failed",
        payloadJson: { channelId: "chan-r1", error: "renewal boom" },
      }),
    })
    expect(result.errors).toBe(1)
    expect(result.renewed).toBe(1)
  })

  it("records the fallback sync failure cause via audit without duplicating credential writes", async () => {
    mocks.credentialFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { channelId: "chan-f1", channel: { tenantId: "tenant-f1" } },
      ])
    mocks.runDelta.mockRejectedValueOnce(new Error("fallback boom"))

    const result = await processOutlookSyncWork()

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-f1",
        action: "outlook.sync.failed",
        payloadJson: { channelId: "chan-f1", error: "fallback boom" },
      }),
    })
    // runOutlookDeltaSync already records lastSyncStatus/lastSyncError in its
    // own catch before rethrowing — the worker must not duplicate that write.
    expect(mocks.credentialUpdate).not.toHaveBeenCalled()
    expect(result.errors).toBe(1)
    expect(result.fallbackSyncs).toBe(0)
  })

  it("does not mark a channel processed after a claimed-event sync fails, so the fallback loop still retries it", async () => {
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-1", channelId: "channel-1", tenantId: "tenant-1", status: "pending" },
    ])
    mocks.credentialFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { channelId: "channel-1", channel: { tenantId: "tenant-1" } },
      ])
    mocks.runDelta
      .mockRejectedValueOnce(new Error("event sync boom"))
      .mockResolvedValueOnce({ ok: true, synced: 1, deleted: 0, hasMore: false })

    const result = await processOutlookSyncWork()

    expect(mocks.runDelta).toHaveBeenCalledTimes(2)
    expect(mocks.runDelta).toHaveBeenNthCalledWith(1, expect.objectContaining({
      channelId: "channel-1",
      requestedMode: "webhook",
    }))
    expect(mocks.runDelta).toHaveBeenNthCalledWith(2, expect.objectContaining({
      channelId: "channel-1",
      requestedMode: "cron",
    }))
    expect(mocks.eventUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "pending", lastError: "sync_failed" }),
    }))
    expect(result.fallbackSyncs).toBe(1)
    expect(result.errors).toBe(1)
  })
})
