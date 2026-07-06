import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCredFindUnique,
  mockLabelsList,
  mockLabelsCreate,
  mockThreadsModify,
} = vi.hoisted(() => ({
  mockCredFindUnique: vi.fn(),
  mockLabelsList: vi.fn(),
  mockLabelsCreate: vi.fn(),
  mockThreadsModify: vi.fn(),
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
        on: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        labels: {
          list: mockLabelsList,
          create: mockLabelsCreate,
        },
        threads: {
          modify: mockThreadsModify,
        },
        messages: {
          modify: vi.fn(),
        },
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

import {
  FLOWDESK_GMAIL_LABEL_NAMES,
  flowDeskLabelsForConversationState,
  normalizeFlowDeskLabelPayload,
} from "@/lib/gmail-labels"
import { applyFlowDeskLabelsToGmailThread } from "@/lib/google"

describe("FlowDesk Gmail labels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredFindUnique.mockResolvedValue({
      channelId: "channel-1",
      accessTokenEncrypted: "enc:access",
      refreshTokenEncrypted: "enc:refresh",
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockLabelsList.mockResolvedValue({
      data: {
        labels: [
          { id: "Label_1", name: "FlowDesk/Needs Reply" },
          { id: "Label_2", name: "FlowDesk/Handled" },
        ],
      },
    })
    mockLabelsCreate.mockImplementation(({ requestBody }: { requestBody: { name: string } }) =>
      Promise.resolve({ data: { id: `created:${requestBody.name}`, name: requestBody.name } })
    )
    mockThreadsModify.mockResolvedValue({ data: {} })
  })

  it("keeps the user-facing Gmail label vocabulary small and friendly", () => {
    expect(FLOWDESK_GMAIL_LABEL_NAMES).toEqual([
      "FlowDesk/Needs Reply",
      "FlowDesk/Needs Action",
      "FlowDesk/Waiting On",
      "FlowDesk/Follow Up",
      "FlowDesk/Read Later",
      "FlowDesk/Important",
      "FlowDesk/Handled",
      "FlowDesk/Autodrafted",
      "FlowDesk/Low Priority",
    ])
  })

  it("does not project Handle First as a Gmail label because it is dashboard ranking", () => {
    expect(
      flowDeskLabelsForConversationState({
        workflowStatus: "needs_reply",
        attentionCategory: "handle_first",
      })
    ).toEqual(["FlowDesk/Needs Reply"])
  })

  it("maps conversation state into Gmail-native labels", () => {
    expect(
      flowDeskLabelsForConversationState({
        workflowStatus: "waiting_on",
        localLabel: "Pricing",
        draftStatus: "proposed",
      })
    ).toEqual(["FlowDesk/Waiting On", "FlowDesk/Autodrafted", "FlowDesk/Important"])

    expect(
      flowDeskLabelsForConversationState({
        workflowStatus: "done",
        attentionCategory: "quiet",
      })
    ).toEqual(["FlowDesk/Handled", "FlowDesk/Low Priority"])
  })

  it("creates missing labels and applies only FlowDesk labels to a Gmail thread", async () => {
    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", [
      "FlowDesk/Needs Reply",
      "FlowDesk/Waiting On",
    ])

    expect(mockLabelsCreate).toHaveBeenCalledWith({
      userId: "me",
      requestBody: expect.objectContaining({
        name: "FlowDesk/Waiting On",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    })
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      requestBody: {
        addLabelIds: ["Label_1", "created:FlowDesk/Waiting On"],
        removeLabelIds: ["Label_2"],
      },
    })
  })

  it("removes every existing FlowDesk label when given an empty label set", async () => {
    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", [])

    expect(mockLabelsCreate).not.toHaveBeenCalled()
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      requestBody: {
        addLabelIds: [],
        removeLabelIds: ["Label_1", "Label_2"],
      },
    })
  })

  it("skips the Gmail call entirely when no FlowDesk labels exist to remove", async () => {
    mockLabelsList.mockResolvedValue({ data: { labels: [{ id: "X", name: "INBOX" }] } })

    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", [])

    expect(mockThreadsModify).not.toHaveBeenCalled()
  })

  it("normalizes label payloads, treating an empty labels array as valid", () => {
    expect(
      normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: [] })
    ).toEqual({ threadId: "thread-1", labels: [] })
    expect(
      normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: ["FlowDesk/Needs Reply", "Bogus"] })
    ).toEqual({ threadId: "thread-1", labels: ["FlowDesk/Needs Reply"] })
    // Missing threadId or a non-array labels field is still invalid.
    expect(normalizeFlowDeskLabelPayload({ labels: [] })).toBeNull()
    expect(normalizeFlowDeskLabelPayload({ threadId: "thread-1" })).toBeNull()
    expect(normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: "all" })).toBeNull()
  })
})
