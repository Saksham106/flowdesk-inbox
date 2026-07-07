import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCredFindUnique,
  mockLabelsList,
  mockLabelsCreate,
  mockLabelsPatch,
  mockLabelsDelete,
  mockThreadsModify,
} = vi.hoisted(() => ({
  mockCredFindUnique: vi.fn(),
  mockLabelsList: vi.fn(),
  mockLabelsCreate: vi.fn(),
  mockLabelsPatch: vi.fn(),
  mockLabelsDelete: vi.fn(),
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
          patch: mockLabelsPatch,
          delete: mockLabelsDelete,
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
    // Default: an already-flat account (connected after the namespace was dropped).
    mockLabelsList.mockResolvedValue({
      data: {
        labels: [
          { id: "Label_1", name: "Needs Reply" },
          { id: "Label_2", name: "Handled" },
        ],
      },
    })
    mockLabelsCreate.mockImplementation(({ requestBody }: { requestBody: { name: string } }) =>
      Promise.resolve({ data: { id: `created:${requestBody.name}`, name: requestBody.name } })
    )
    mockLabelsPatch.mockResolvedValue({ data: {} })
    mockLabelsDelete.mockResolvedValue({ data: {} })
    mockThreadsModify.mockResolvedValue({ data: {} })
  })

  it("keeps the user-facing Gmail label vocabulary small, flat, and friendly", () => {
    expect(FLOWDESK_GMAIL_LABEL_NAMES).toEqual([
      "Needs Reply",
      "Needs Action",
      "Waiting On",
      "Follow Up",
      "Read Later",
      "Important",
      "Handled",
      "Autodrafted",
      "Low Priority",
    ])
  })

  it("maps conversation state into Gmail-native labels", () => {
    expect(
      flowDeskLabelsForConversationState({
        workflowStatus: "waiting_on",
        localLabel: "Pricing",
        draftStatus: "proposed",
      })
    ).toEqual(["Waiting On", "Autodrafted", "Important"])

    expect(
      flowDeskLabelsForConversationState({
        workflowStatus: "done",
        attentionCategory: "quiet",
      })
    ).toEqual(["Handled", "Low Priority"])
  })

  it("creates missing labels and applies only FlowDesk labels to a Gmail thread", async () => {
    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", [
      "Needs Reply",
      "Waiting On",
    ])

    expect(mockLabelsCreate).toHaveBeenCalledWith({
      userId: "me",
      requestBody: expect.objectContaining({
        name: "Waiting On",
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    })
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      requestBody: {
        addLabelIds: ["Label_1", "created:Waiting On"],
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

  it("renames legacy FlowDesk/* labels in place and deletes the empty parent", async () => {
    // A pre-flattening account: nested labels plus the auto-created parent.
    mockLabelsList.mockResolvedValue({
      data: {
        labels: [
          { id: "Legacy_Parent", name: "FlowDesk" },
          { id: "Legacy_1", name: "FlowDesk/Needs Reply" },
          { id: "Legacy_2", name: "FlowDesk/Handled" },
        ],
      },
    })

    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", ["Needs Reply"])

    // Legacy labels are renamed in place (keeping their ids), not recreated.
    expect(mockLabelsPatch).toHaveBeenCalledWith({
      userId: "me",
      id: "Legacy_1",
      requestBody: { name: "Needs Reply" },
    })
    expect(mockLabelsPatch).toHaveBeenCalledWith({
      userId: "me",
      id: "Legacy_2",
      requestBody: { name: "Handled" },
    })
    // The now-childless "FlowDesk" parent is removed.
    expect(mockLabelsDelete).toHaveBeenCalledWith({ userId: "me", id: "Legacy_Parent" })
    expect(mockLabelsCreate).not.toHaveBeenCalled()

    // The renamed ids are used for the thread modify: keep Needs Reply, drop Handled.
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      requestBody: {
        addLabelIds: ["Legacy_1"],
        removeLabelIds: ["Legacy_2"],
      },
    })
  })

  it("leaves a legacy label untouched when its flat name already exists", async () => {
    // Partially-migrated account: both the flat and the legacy label are present.
    mockLabelsList.mockResolvedValue({
      data: {
        labels: [
          { id: "Flat_1", name: "Needs Reply" },
          { id: "Legacy_1", name: "FlowDesk/Needs Reply" },
        ],
      },
    })

    await applyFlowDeskLabelsToGmailThread("channel-1", "thread-1", ["Needs Reply"])

    expect(mockLabelsPatch).not.toHaveBeenCalled()
    // The flat label wins; the legacy one is left alone (still nested, so the
    // parent is not deleted either).
    expect(mockLabelsDelete).not.toHaveBeenCalled()
    expect(mockThreadsModify).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      requestBody: {
        addLabelIds: ["Flat_1"],
        removeLabelIds: [],
      },
    })
  })

  it("normalizes label payloads, treating an empty labels array as valid", () => {
    expect(
      normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: [] })
    ).toEqual({ threadId: "thread-1", labels: [] })
    expect(
      normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: ["Needs Reply", "Bogus"] })
    ).toEqual({ threadId: "thread-1", labels: ["Needs Reply"] })
    // Missing threadId or a non-array labels field is still invalid.
    expect(normalizeFlowDeskLabelPayload({ labels: [] })).toBeNull()
    expect(normalizeFlowDeskLabelPayload({ threadId: "thread-1" })).toBeNull()
    expect(normalizeFlowDeskLabelPayload({ threadId: "thread-1", labels: "all" })).toBeNull()
  })
})
