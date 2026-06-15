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
} = vi.hoisted(() => ({
  mockChannelFindFirst: vi.fn(),
  mockCredFindUnique: vi.fn(),
  mockCredUpdate: vi.fn(),
  mockCredUpdateMany: vi.fn(),
  mockSyncGmailChannel: vi.fn(),
  mockSyncGmailChannelIncremental: vi.fn(),
  mockWatchGmailChannel: vi.fn(),
  mockFetchLatestHistoryId: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findFirst: mockChannelFindFirst },
    gmailCredential: {
      findUnique: mockCredFindUnique,
      update: mockCredUpdate,
      updateMany: mockCredUpdateMany,
    },
  },
}))

vi.mock("@/lib/google", () => ({
  fetchLatestHistoryId: mockFetchLatestHistoryId,
  syncGmailChannel: mockSyncGmailChannel,
  syncGmailChannelIncremental: mockSyncGmailChannelIncremental,
  watchGmailChannel: mockWatchGmailChannel,
}))

import { processGmailPushNotification, runGmailSync } from "@/lib/gmail-sync"

const channel = {
  id: "channel-1",
  tenantId: "tenant-1",
  emailAddress: "owner@example.com",
  gmailCredential: { historyId: "history-1" },
}

function pubsubPayload(emailAddress = "owner@example.com", historyId = "history-2") {
  return {
    message: {
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

  it("skips duplicate push notifications when the account is already locked", async () => {
    mockCredUpdateMany.mockResolvedValue({ count: 0 })

    const result = await processGmailPushNotification(pubsubPayload())

    expect(result).toEqual({ ok: true, channelId: "channel-1", skipped: "sync_in_progress" })
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
        data: expect.objectContaining({ historyId: "history-3", lastSyncMode: "history_fallback" }),
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
