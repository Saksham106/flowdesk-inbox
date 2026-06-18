import { describe, expect, it } from "vitest"

import { isFyiConversation } from "@/lib/inbox-fyi"

function conv(overrides: Partial<Parameters<typeof isFyiConversation>[0]> = {}) {
  return {
    status: "needs_reply",
    stateRecord: null,
    contact: { phoneE164: "noreply@example.com" },
    messages: [{ direction: "inbound", body: "This is an automated notification." }],
    ...overrides,
  }
}

describe("isFyiConversation", () => {
  it("treats unclassified automated inbound emails as FYI", () => {
    expect(isFyiConversation(conv())).toBe(true)
  })

  it("does not hide explicit needs_reply corrections", () => {
    expect(
      isFyiConversation(
        conv({
          stateRecord: {
            state: "needs_reply",
            attentionCategory: "needs_reply",
            emailType: null,
            metadataJson: { attentionCategory: "needs_reply" },
          },
        })
      )
    ).toBe(false)
  })

  it("treats denormalized quiet and notification state as FYI", () => {
    expect(
      isFyiConversation(
        conv({
          contact: { phoneE164: "alice@example.com" },
          messages: [{ direction: "inbound", body: "Status update" }],
          stateRecord: {
            state: "fyi_only",
            attentionCategory: null,
            emailType: "notification",
            metadataJson: {},
          },
        })
      )
    ).toBe(true)
  })
})
