import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockCredFindUnique, mockCredUpdate, mockWatch } = vi.hoisted(() => ({
  mockCredFindUnique: vi.fn(),
  mockCredUpdate: vi.fn(),
  mockWatch: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailCredential: { findUnique: mockCredFindUnique, update: mockCredUpdate },
  },
}))

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        on: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        watch: mockWatch,
      },
    }),
  },
}))

vi.mock("@/lib/crypto", () => ({
  encryptString: (s: string) => `enc:${s}`,
  decryptString: (s: string) => s.replace(/^enc:/, ""),
}))

vi.mock("@/lib/agent/work-item-sync", () => ({
  syncConversationWorkItems: vi.fn(),
}))

import { watchGmailChannel } from "@/lib/google"

describe("watchGmailChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredFindUnique.mockResolvedValue({
      channelId: "channel-1",
      accessTokenEncrypted: "enc:access",
      refreshTokenEncrypted: "enc:refresh",
      tokenExpiry: null,
      historyId: "history-before-watch",
    })
    mockCredUpdate.mockResolvedValue({})
    mockWatch.mockResolvedValue({
      data: {
        historyId: "history-from-watch",
        expiration: "1781568000000",
      },
    })
  })

  it("stores the returned watch historyId and expiration", async () => {
    const result = await watchGmailChannel("channel-1", "projects/demo/topics/gmail")

    expect(result.historyId).toBe("history-from-watch")
    expect(result.expiration.toISOString()).toBe("2026-06-16T00:00:00.000Z")
    expect(mockCredUpdate).toHaveBeenCalledWith({
      where: { channelId: "channel-1" },
      data: expect.objectContaining({
        historyId: "history-from-watch",
        watchExpiresAt: new Date("2026-06-16T00:00:00.000Z"),
        lastSyncMode: "watch_renewal",
        lastSyncStatus: "success",
        lastSyncError: null,
      }),
    })
  })
})
