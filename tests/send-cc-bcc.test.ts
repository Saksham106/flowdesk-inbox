import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConversationFindFirst,
  mockConversationUpdate,
  mockMessageCreate,
  mockAuditCreate,
  mockTransaction,
  mockGetGmailClient,
  mockFetchThread,
  mockSendGmailReply,
  mockProjectLabels,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockConversationUpdate: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetGmailClient: vi.fn(),
  mockFetchThread: vi.fn(),
  mockSendGmailReply: vi.fn(),
  mockProjectLabels: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: mockConversationFindFirst, update: mockConversationUpdate },
    message: { create: mockMessageCreate },
    auditLog: { create: mockAuditCreate },
    $transaction: mockTransaction,
  },
}))

vi.mock("@/lib/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google")>()
  return {
    ...actual,
    getGmailClient: mockGetGmailClient,
    fetchThread: mockFetchThread,
    sendGmailReply: mockSendGmailReply,
  }
})

vi.mock("@/lib/gmail-labels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gmail-labels")>()
  return {
    ...actual,
    projectFlowDeskLabelsForConversation: mockProjectLabels,
  }
})

import { buildReplyMimeRaw } from "@/lib/google"
import {
  MAX_RECIPIENTS_PER_FIELD,
  normalizeRecipientList,
  RecipientValidationError,
} from "@/lib/conversations/recipients"
import { ConversationSendError, sendConversationMessage } from "@/lib/conversations/send-message"

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8")
}

function headerLines(raw: string): string[] {
  return decodeRaw(raw).split("\r\n\r\n")[0].split("\r\n")
}

describe("buildReplyMimeRaw CC/BCC", () => {
  const base = {
    to: "them@example.com",
    from: "me@example.com",
    subject: "Hello",
    body: "Reply body",
  }

  it("emits no Cc/Bcc headers when lists are absent or empty", () => {
    for (const input of [base, { ...base, cc: [], bcc: [] }]) {
      const headers = headerLines(buildReplyMimeRaw(input))
      expect(headers.some((line) => line.startsWith("Cc:"))).toBe(false)
      expect(headers.some((line) => line.startsWith("Bcc:"))).toBe(false)
    }
  })

  it("emits comma-joined Cc and Bcc headers", () => {
    const raw = buildReplyMimeRaw({
      ...base,
      cc: ["cc1@example.com", "cc2@example.com"],
      bcc: ["hidden@example.com"],
    })
    const headers = headerLines(raw)
    expect(headers).toContain("Cc: cc1@example.com, cc2@example.com")
    expect(headers).toContain("Bcc: hidden@example.com")
  })

  it("keeps threading headers and Re: subject alongside Cc/Bcc", () => {
    const raw = buildReplyMimeRaw({
      ...base,
      cc: ["cc@example.com"],
      inReplyTo: "<msg-1@mail>",
      references: "<msg-1@mail>",
    })
    const headers = headerLines(raw)
    expect(headers).toContain("Subject: Re: Hello")
    expect(headers).toContain("In-Reply-To: <msg-1@mail>")
    expect(headers).toContain("References: <msg-1@mail>")
    expect(headers).toContain("To: them@example.com")
  })
})

describe("normalizeRecipientList", () => {
  it("returns [] for undefined/null", () => {
    expect(normalizeRecipientList(undefined, "CC")).toEqual([])
    expect(normalizeRecipientList(null, "CC")).toEqual([])
  })

  it("trims, lowercases, dedupes, and drops blank entries", () => {
    expect(
      normalizeRecipientList([" A@Example.com ", "a@example.com", "", "b@example.com"], "CC")
    ).toEqual(["a@example.com", "b@example.com"])
  })

  it("rejects non-arrays and non-string entries", () => {
    expect(() => normalizeRecipientList("a@example.com", "CC")).toThrow(RecipientValidationError)
    expect(() => normalizeRecipientList([42], "CC")).toThrow(RecipientValidationError)
  })

  it("rejects malformed addresses", () => {
    for (const bad of ["not-an-email", "a@b", "a b@example.com", "Name <a@example.com>"]) {
      expect(() => normalizeRecipientList([bad], "BCC")).toThrow(RecipientValidationError)
    }
  })

  it("rejects header-injection attempts (CR/LF)", () => {
    expect(() =>
      normalizeRecipientList(["victim@example.com\r\nBcc: attacker@evil.com"], "CC")
    ).toThrow(RecipientValidationError)
    expect(() => normalizeRecipientList(["a@example.com\n"], "CC")).toThrow(RecipientValidationError)
  })

  it("caps list size", () => {
    const list = Array.from({ length: MAX_RECIPIENTS_PER_FIELD + 1 }, (_, i) => `u${i}@example.com`)
    expect(() => normalizeRecipientList(list, "CC")).toThrow(RecipientValidationError)
  })
})

describe("sendConversationMessage CC/BCC", () => {
  const conversation = {
    id: "conv-1",
    tenantId: "t1",
    channelId: "ch-1",
    externalThreadId: "thread-1",
    channel: {
      type: "email",
      provider: "google",
      emailAddress: "me@example.com",
    },
    contact: { phoneE164: "them@example.com" },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationFindFirst.mockResolvedValue(conversation)
    mockGetGmailClient.mockResolvedValue({})
    mockFetchThread.mockResolvedValue([
      {
        subject: "Hello",
        from: "them@example.com",
        rfc822MessageId: "<msg-1@mail>",
      },
    ])
    mockSendGmailReply.mockResolvedValue("gmail-msg-1")
    mockTransaction.mockResolvedValue([])
    mockProjectLabels.mockResolvedValue(undefined)
  })

  it("passes cc/bcc to the Gmail send and persists them on the Message row", async () => {
    await sendConversationMessage({
      conversationId: "conv-1",
      tenantId: "t1",
      userId: "u1",
      text: "Reply body",
      cc: ["CC1@Example.com", "cc2@example.com"],
      bcc: ["hidden@example.com"],
    })

    expect(mockSendGmailReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "them@example.com",
        cc: ["cc1@example.com", "cc2@example.com"],
        bcc: ["hidden@example.com"],
      })
    )

    expect(mockMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "outbound",
        ccEmails: ["cc1@example.com", "cc2@example.com"],
        bccEmails: ["hidden@example.com"],
      }),
    })

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "conversation.send",
        payloadJson: expect.objectContaining({
          cc: ["cc1@example.com", "cc2@example.com"],
          bcc: ["hidden@example.com"],
        }),
      }),
    })
  })

  it("omits ccEmails/bccEmails and audit keys when none provided", async () => {
    await sendConversationMessage({
      conversationId: "conv-1",
      tenantId: "t1",
      text: "Reply body",
    })

    expect(mockSendGmailReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cc: [], bcc: [] })
    )
    const messageData = mockMessageCreate.mock.calls[0][0].data
    expect(messageData.ccEmails).toBeUndefined()
    expect(messageData.bccEmails).toBeUndefined()
    const auditPayload = mockAuditCreate.mock.calls[0][0].data.payloadJson
    expect(auditPayload).not.toHaveProperty("cc")
    expect(auditPayload).not.toHaveProperty("bcc")
  })

  it("rejects invalid cc addresses with a 400 before contacting Gmail", async () => {
    await expect(
      sendConversationMessage({
        conversationId: "conv-1",
        tenantId: "t1",
        text: "Reply body",
        cc: ["bad address"],
      })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      sendConversationMessage({
        conversationId: "conv-1",
        tenantId: "t1",
        text: "Reply body",
        bcc: ["victim@example.com\r\nX: y"],
      })
    ).rejects.toBeInstanceOf(ConversationSendError)
    expect(mockSendGmailReply).not.toHaveBeenCalled()
    expect(mockMessageCreate).not.toHaveBeenCalled()
  })
})
