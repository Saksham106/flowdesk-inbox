import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockChannelFindFirst,
  mockCredFindUnique,
  mockCredUpdate,
  mockCredUpdateMany,
  mockSyncGmailChannel,
  mockSyncGmailChannelIncremental,
  mockWatchGmailChannel,
  mockFetchLatestHistoryId,
  mockPushFindUnique,
  mockPushUpsert,
  mockPushUpdate,
} = vi.hoisted(() => ({
  mockChannelFindFirst: vi.fn(),
  mockCredFindUnique: vi.fn(),
  mockCredUpdate: vi.fn(),
  mockCredUpdateMany: vi.fn(),
  mockSyncGmailChannel: vi.fn(),
  mockSyncGmailChannelIncremental: vi.fn(),
  mockWatchGmailChannel: vi.fn(),
  mockFetchLatestHistoryId: vi.fn(),
  mockPushFindUnique: vi.fn(),
  mockPushUpsert: vi.fn(),
  mockPushUpdate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findFirst: mockChannelFindFirst },
    gmailCredential: {
      findUnique: mockCredFindUnique,
      update: mockCredUpdate,
      updateMany: mockCredUpdateMany,
    },
    gmailPushEvent: {
      findUnique: mockPushFindUnique,
      upsert: mockPushUpsert,
      update: mockPushUpdate,
    },
  },
}))

vi.mock("@/lib/google", () => ({
  fetchLatestHistoryId: mockFetchLatestHistoryId,
  normalizeGmailSyncThreadLimit: (value?: number | null) => {
    if (!Number.isFinite(value ?? NaN)) return 25
    return Math.max(1, Math.min(50, Math.floor(value as number)))
  },
  syncGmailChannel: mockSyncGmailChannel,
  syncGmailChannelIncremental: mockSyncGmailChannelIncremental,
  watchGmailChannel: mockWatchGmailChannel,
}))

import { GmailAuthError, processGmailPushNotification, runGmailSync } from "@/lib/gmail-sync"

const channel = {
  id: "channel-1",
  tenantId: "tenant-1",
  emailAddress: "owner@example.com",
  gmailCredential: { historyId: "history-1" },
}

function pubsubPayload(emailAddress = "owner@example.com", historyId = "history-2") {
  return {
    message: {
      messageId: "pubsub-message-1",
      data: Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64url"),
    },
  }
}

describe("Gmail sync runner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GMAIL_PUSH_TOPIC
    mockChannelFindFirst.mockResolvedValue(channel)
    mockCredFindUnique.mockResolvedValue({ channelId: "channel-1", historyId: "history-1" })
    mockCredUpdateMany.mockResolvedValue({ count: 1 })
    mockCredUpdate.mockResolvedValue({})
    mockSyncGmailChannel.mockResolvedValue(3)
    mockSyncGmailChannelIncremental.mockResolvedValue({ synced: 2, newHistoryId: "history-2" })
    mockWatchGmailChannel.mockResolvedValue({ expiration: new Date("2026-06-16T00:00:00Z"), historyId: "history-2" })
    mockFetchLatestHistoryId.mockResolvedValue("history-3")
    mockPushFindUnique.mockResolvedValue(null)
    mockPushUpsert.mockResolvedValue({})
    mockPushUpdate.mockResolvedValue({})
  })

  it("uses one DB lock for manual incremental sync", async () => {
    const result = await runGmailSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
      incremental: true,
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, synced: 2, mode: "manual_incremental" }))
    expect(mockCredUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channelId: "channel-1" }),
        data: expect.objectContaining({ syncLockExpiresAt: expect.any(Date) }),
      })
    )
    expect(mockSyncGmailChannelIncremental).toHaveBeenCalledWith("channel-1", "tenant-1")
    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: "channel-1" },
        data: expect.objectContaining({
          lastSyncMode: "manual_incremental",
          lastSyncStatus: "success",
          lastSyncError: null,
          syncLockExpiresAt: null,
        }),
      })
    )
  })

  it("passes the requested full-sync thread cap to the Gmail importer", async () => {
    await runGmailSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
      incremental: false,
      maxThreads: 20,
    })

    expect(mockSyncGmailChannel).toHaveBeenCalledWith("channel-1", "tenant-1", {
      maxThreads: 20,
    })
  })

  it("caps requested full-sync thread batches at 50", async () => {
    await runGmailSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
      incremental: false,
      maxThreads: 500,
    })

    expect(mockSyncGmailChannel).toHaveBeenCalledWith("channel-1", "tenant-1", {
      maxThreads: 50,
    })
  })

  it("skips duplicate push notifications when the account is already locked", async () => {
    mockCredUpdateMany.mockResolvedValue({ count: 0 })

    const result = await processGmailPushNotification(pubsubPayload())

    expect(result).toEqual({ ok: true, channelId: "channel-1", skipped: "sync_in_progress" })
    expect(mockPushUpdate).toHaveBeenCalledWith({
      where: { messageId: "pubsub-message-1" },
      data: expect.objectContaining({
        status: "failed",
        error: "sync_in_progress",
        processedAt: expect.any(Date),
      }),
    })
    expect(mockSyncGmailChannel).not.toHaveBeenCalled()
    expect(mockSyncGmailChannelIncremental).not.toHaveBeenCalled()
  })

  it("records Gmail push event lifecycle by Pub/Sub message id", async () => {
    await processGmailPushNotification(pubsubPayload())

    expect(mockPushUpsert).toHaveBeenCalledWith({
      where: { messageId: "pubsub-message-1" },
      create: expect.objectContaining({
        tenantId: "tenant-1",
        channelId: "channel-1",
        historyId: "history-2",
        messageId: "pubsub-message-1",
        status: "processing",
      }),
      update: expect.objectContaining({
        status: "processing",
        error: null,
      }),
    })
    expect(mockPushUpdate).toHaveBeenCalledWith({
      where: { messageId: "pubsub-message-1" },
      data: expect.objectContaining({
        status: "completed",
        processedAt: expect.any(Date),
      }),
    })
  })

  it("does not reprocess completed Gmail push events", async () => {
    mockPushFindUnique.mockResolvedValue({ messageId: "pubsub-message-1", status: "completed" })

    const result = await processGmailPushNotification(pubsubPayload())

    expect(result).toEqual({ ok: true, skipped: "push_already_completed" })
    expect(mockCredUpdateMany).not.toHaveBeenCalled()
    expect(mockSyncGmailChannel).not.toHaveBeenCalled()
    expect(mockSyncGmailChannelIncremental).not.toHaveBeenCalled()
  })

  it("falls back to a safe recent sync when the Gmail history cursor expired", async () => {
    const historyError = new Error("HistoryId expired")
    Object.assign(historyError, { code: 404 })
    mockSyncGmailChannelIncremental.mockRejectedValue(historyError)

    const result = await runGmailSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "push",
      incremental: true,
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, synced: 3, mode: "history_fallback" }))
    expect(mockSyncGmailChannel).toHaveBeenCalledWith("channel-1", "tenant-1")
    expect(mockFetchLatestHistoryId).toHaveBeenCalledWith("channel-1")
    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: "channel-1" },
        data: expect.objectContaining({
          historyId: "history-3",
          lastSyncMode: "history_fallback",
          lastHistoryFallbackAt: expect.any(Date),
        }),
      })
    )
  })

  it("marks credential as needs_reauth and throws GmailAuthError on invalid_grant", async () => {
    const authError = new Error("invalid_grant")
    mockSyncGmailChannel.mockRejectedValue(authError)
    mockCredFindUnique.mockResolvedValue({ channelId: "channel-1", historyId: null })

    await expect(
      runGmailSync({
        channelId: "channel-1",
        tenantId: "tenant-1",
        requestedMode: "manual",
        incremental: false,
      })
    ).rejects.toBeInstanceOf(GmailAuthError)

    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: "channel-1" },
        data: expect.objectContaining({
          lastSyncStatus: "needs_reauth",
          lastSyncError: expect.stringContaining("reconnect"),
          syncLockExpiresAt: null,
        }),
      })
    )
  })

  it("marks needs_reauth for token-expired Google error variants", async () => {
    const revokedError = new Error("Token has been expired or revoked.")
    mockSyncGmailChannelIncremental.mockRejectedValue(revokedError)

    await expect(
      runGmailSync({
        channelId: "channel-1",
        tenantId: "tenant-1",
        requestedMode: "manual",
        incremental: true,
      })
    ).rejects.toBeInstanceOf(GmailAuthError)

    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: "needs_reauth" }),
      })
    )
  })

  it("does not mark needs_reauth for non-auth errors", async () => {
    const networkError = new Error("ECONNRESET")
    mockSyncGmailChannel.mockRejectedValue(networkError)
    mockCredFindUnique.mockResolvedValue({ channelId: "channel-1", historyId: null })

    await expect(
      runGmailSync({
        channelId: "channel-1",
        tenantId: "tenant-1",
        requestedMode: "manual",
        incremental: false,
      })
    ).rejects.toThrow("ECONNRESET")

    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncStatus: "error" }),
      })
    )
  })

  it("sets up Gmail watch after sync when push is configured", async () => {
    process.env.GMAIL_PUSH_TOPIC = "projects/demo/topics/gmail"

    await runGmailSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
      incremental: true,
      ensureWatch: true,
    })

    expect(mockWatchGmailChannel).toHaveBeenCalledWith("channel-1", "projects/demo/topics/gmail")
  })
})
