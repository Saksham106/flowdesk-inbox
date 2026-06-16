import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockCredFindUnique,
  mockThreadsModify,
  mockThreadsTrash,
  mockOnTokens,
} = vi.hoisted(() => ({
  mockCredFindUnique: vi.fn(),
  mockThreadsModify: vi.fn(),
  mockThreadsTrash: vi.fn(),
  mockOnTokens: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gmailCredential: { findUnique: mockCredFindUnique },
  },
}))

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        on: mockOnTokens,
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        threads: { modify: mockThreadsModify, trash: mockThreadsTrash },
      },
    }),
  },
}))

vi.mock("@/lib/crypto", () => ({
  encryptString: (s: string) => `enc:${s}`,
  decryptString: (s: string) => s.replace(/^enc:/, ""),
}))

import { archiveGmailThread, trashGmailThread } from "@/lib/google"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHANNEL_ID = "channel-1"
const THREAD_ID = "thread-abc123"

const fakeCred = {
  channelId: CHANNEL_ID,
  accessTokenEncrypted: "enc:access-token",
  refreshTokenEncrypted: "enc:refresh-token",
  tokenExpiry: new Date(Date.now() + 3600_000),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCredFindUnique.mockResolvedValue(fakeCred)
  mockThreadsModify.mockResolvedValue({ data: {} })
  mockThreadsTrash.mockResolvedValue({ data: {} })
})

// ---------------------------------------------------------------------------
// archiveGmailThread
// ---------------------------------------------------------------------------

describe("archiveGmailThread", () => {
  it("calls threads.modify with removeLabelIds: [INBOX]", async () => {
    await archiveGmailThread(CHANNEL_ID, THREAD_ID)

    expect(mockThreadsModify).toHaveBeenCalledOnce()
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: THREAD_ID,
      requestBody: { removeLabelIds: ["INBOX"] },
    })
  })

  it("does not call threads.trash", async () => {
    await archiveGmailThread(CHANNEL_ID, THREAD_ID)
    expect(mockThreadsTrash).not.toHaveBeenCalled()
  })

  it("throws if credential is not found", async () => {
    mockCredFindUnique.mockResolvedValue(null)
    await expect(archiveGmailThread(CHANNEL_ID, THREAD_ID)).rejects.toThrow(
      "No Gmail credential found for channel"
    )
  })

  it("propagates Gmail API errors", async () => {
    mockThreadsModify.mockRejectedValue(new Error("Gmail API 403"))
    await expect(archiveGmailThread(CHANNEL_ID, THREAD_ID)).rejects.toThrow("Gmail API 403")
  })
})

// ---------------------------------------------------------------------------
// trashGmailThread
// ---------------------------------------------------------------------------

describe("trashGmailThread", () => {
  it("calls threads.trash with the thread id", async () => {
    await trashGmailThread(CHANNEL_ID, THREAD_ID)

    expect(mockThreadsTrash).toHaveBeenCalledOnce()
    expect(mockThreadsTrash).toHaveBeenCalledWith({
      userId: "me",
      id: THREAD_ID,
    })
  })

  it("does not call threads.modify", async () => {
    await trashGmailThread(CHANNEL_ID, THREAD_ID)
    expect(mockThreadsModify).not.toHaveBeenCalled()
  })

  it("throws if credential is not found", async () => {
    mockCredFindUnique.mockResolvedValue(null)
    await expect(trashGmailThread(CHANNEL_ID, THREAD_ID)).rejects.toThrow(
      "No Gmail credential found for channel"
    )
  })

  it("propagates Gmail API errors", async () => {
    mockThreadsTrash.mockRejectedValue(new Error("Gmail API 404"))
    await expect(trashGmailThread(CHANNEL_ID, THREAD_ID)).rejects.toThrow("Gmail API 404")
  })
})
