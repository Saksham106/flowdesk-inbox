import { describe, expect, it } from "vitest"
import { stillNeedsCleanup } from "@/lib/cleanup-candidates"

const inInbox = { threadId: "t1", unread: false, lastLabelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }
const archivedInGmail = { threadId: "t1", unread: false, lastLabelIds: ["CATEGORY_PROMOTIONS"] }

describe("stillNeedsCleanup", () => {
  it("keeps a Gmail conversation still sitting in INBOX, even when locally closed", () => {
    expect(
      stillNeedsCleanup({ provider: "google", gmailRawState: inInbox, stateMetadata: {} })
    ).toBe(true)
  })

  it("drops a Gmail conversation whose thread already left INBOX", () => {
    expect(
      stillNeedsCleanup({ provider: "google", gmailRawState: archivedInGmail, stateMetadata: {} })
    ).toBe(false)
  })

  it("drops a conversation already archived through Clean Inbox, even if labels are stale", () => {
    expect(
      stillNeedsCleanup({
        provider: "google",
        gmailRawState: inInbox,
        stateMetadata: { cleanInboxArchived: true },
      })
    ).toBe(false)
  })

  it("keeps a conversation after a Clean Inbox undo (marker reset to false)", () => {
    expect(
      stillNeedsCleanup({
        provider: "google",
        gmailRawState: inInbox,
        stateMetadata: { cleanInboxArchived: false },
      })
    ).toBe(true)
  })

  it("drops a conversation the user archived individually (archivedAt marker)", () => {
    expect(
      stillNeedsCleanup({
        provider: "google",
        gmailRawState: inInbox,
        stateMetadata: { archivedAt: "2026-07-10T00:00:00.000Z" },
      })
    ).toBe(false)
  })

  it("keeps Gmail conversations with no recorded label state (pre-gmailRawState rows)", () => {
    expect(stillNeedsCleanup({ provider: "google", gmailRawState: null, stateMetadata: {} })).toBe(
      true
    )
  })

  it("keeps non-Gmail conversations regardless of label state", () => {
    expect(
      stillNeedsCleanup({ provider: "outlook", gmailRawState: null, stateMetadata: {} })
    ).toBe(true)
  })
})
