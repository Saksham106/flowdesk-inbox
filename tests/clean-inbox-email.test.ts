import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockArchiveConversation, mockRestoreConversation, mockGetWritebackAdapter } = vi.hoisted(
  () => ({
    mockArchiveConversation: vi.fn(),
    mockRestoreConversation: vi.fn(),
    mockGetWritebackAdapter: vi.fn(),
  })
)

vi.mock("@/lib/email/writeback-adapter", () => ({
  getWritebackAdapter: mockGetWritebackAdapter,
}))

import {
  archivableInProviderMailbox,
  archiveConversationsInProviderMailbox,
  restoreConversationsInProviderMailbox,
} from "@/lib/clean-inbox-email"

function conv(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    channelId: "ch1",
    externalThreadId: "thread-1",
    channel: { provider: "google" },
    ...overrides,
  }
}

const GOOGLE_ADAPTER = {
  provider: "google",
  archiveConversation: mockArchiveConversation,
  restoreConversation: mockRestoreConversation,
}

const MICROSOFT_ADAPTER = {
  provider: "microsoft",
  archiveConversation: mockArchiveConversation,
  restoreConversation: mockRestoreConversation,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockArchiveConversation.mockResolvedValue(undefined)
  mockRestoreConversation.mockResolvedValue(undefined)
  mockGetWritebackAdapter.mockImplementation((provider: string | null | undefined) => {
    if (provider === "google") return GOOGLE_ADAPTER
    if (provider === "microsoft") return MICROSOFT_ADAPTER
    return null
  })
})

describe("archivableInProviderMailbox", () => {
  it("keeps google and microsoft conversations with a thread id, drops sms and thread-less rows", () => {
    const result = archivableInProviderMailbox([
      conv({ id: "gmail" }),
      conv({ id: "outlook", channel: { provider: "microsoft" } }),
      conv({ id: "sms", channel: { provider: "twilio" } }),
      conv({ id: "no-thread", externalThreadId: null }),
      conv({ id: "no-channel", channel: null }),
    ])

    expect(result.map((c) => c.id)).toEqual(["gmail", "outlook"])
  })
})

describe("archiveConversationsInProviderMailbox", () => {
  it("archives a mixed batch of google + microsoft conversations via their own adapters, skipping sms", async () => {
    const convs = [
      conv({ id: "gmail-1", channelId: "gch1", externalThreadId: "gt1", channel: { provider: "google" } }),
      conv({
        id: "outlook-1",
        channelId: "och1",
        externalThreadId: "ot1",
        channel: { provider: "microsoft" },
      }),
      conv({ id: "sms-1", channel: { provider: "twilio" } }),
    ]

    const result = await archiveConversationsInProviderMailbox(convs)

    expect(mockArchiveConversation).toHaveBeenCalledWith("gch1", "gt1")
    expect(mockArchiveConversation).toHaveBeenCalledWith("och1", "ot1")
    expect(mockArchiveConversation).toHaveBeenCalledTimes(2)
    expect(result.archived.sort()).toEqual(["gmail-1", "outlook-1"])
    expect(result.failed).toEqual([])
  })

  it("puts a failed microsoft archive in `failed` without failing the whole batch", async () => {
    mockArchiveConversation.mockImplementation(async (channelId: string) => {
      if (channelId === "och1") throw new Error("graph 500")
    })

    const convs = [
      conv({ id: "gmail-1", channelId: "gch1", externalThreadId: "gt1", channel: { provider: "google" } }),
      conv({
        id: "outlook-1",
        channelId: "och1",
        externalThreadId: "ot1",
        channel: { provider: "microsoft" },
      }),
    ]

    const result = await archiveConversationsInProviderMailbox(convs)

    expect(result.archived).toEqual(["gmail-1"])
    expect(result.failed).toEqual(["outlook-1"])
  })
})

describe("restoreConversationsInProviderMailbox", () => {
  it("restores both google and microsoft conversations via their own adapters", async () => {
    const convs = [
      conv({ id: "gmail-1", channelId: "gch1", externalThreadId: "gt1", channel: { provider: "google" } }),
      conv({
        id: "outlook-1",
        channelId: "och1",
        externalThreadId: "ot1",
        channel: { provider: "microsoft" },
      }),
    ]

    const result = await restoreConversationsInProviderMailbox(convs)

    expect(mockRestoreConversation).toHaveBeenCalledWith("gch1", "gt1")
    expect(mockRestoreConversation).toHaveBeenCalledWith("och1", "ot1")
    expect(result.archived.sort()).toEqual(["gmail-1", "outlook-1"])
    expect(result.failed).toEqual([])
  })
})
