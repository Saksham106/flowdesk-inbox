import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCredFindUnique,
  mockMessagesModify,
  mockWritebackUpsert,
} = vi.hoisted(() => ({
  mockCredFindUnique: vi.fn(),
  mockMessagesModify: vi.fn(),
  mockWritebackUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailCredential: { findUnique: mockCredFindUnique },
    emailWritebackQueue: { upsert: mockWritebackUpsert },
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
        messages: { modify: mockMessagesModify },
      },
    }),
  },
}))

vi.mock("@/lib/crypto", () => ({
  encryptString: (s: string) => `enc:${s}`,
  decryptString: (s: string) => s.replace(/^enc:/, ""),
}))

import { markGmailThreadRead } from "@/lib/google"

describe("markGmailThreadRead", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredFindUnique.mockResolvedValue({
      channelId: "channel-1",
      accessTokenEncrypted: "enc:access",
      refreshTokenEncrypted: "enc:refresh",
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockWritebackUpsert.mockResolvedValue({})
  })

  it("retries failed Gmail read writeback and queues it after final failure", async () => {
    mockMessagesModify.mockRejectedValue(new Error("rate limited"))

    await expect(
      markGmailThreadRead("channel-1", ["gmail_msg-1"], {
        tenantId: "tenant-1",
        conversationId: "conv-1",
      })
    ).rejects.toThrow("rate limited")

    expect(mockMessagesModify).toHaveBeenCalledTimes(3)
    expect(mockWritebackUpsert).toHaveBeenCalledWith({
      where: {
        conversationId_action: {
          conversationId: "conv-1",
          action: "mark_read",
        },
      },
      create: expect.objectContaining({
        tenantId: "tenant-1",
        channelId: "channel-1",
        conversationId: "conv-1",
        action: "mark_read",
        providerMessageIdsJson: ["gmail_msg-1"],
        attempts: 1,
        lastError: "rate limited",
      }),
      update: expect.objectContaining({
        providerMessageIdsJson: ["gmail_msg-1"],
        lastError: "rate limited",
        nextAttemptAt: expect.any(Date),
      }),
    })
  })
})
