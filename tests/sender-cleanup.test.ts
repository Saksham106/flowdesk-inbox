import { describe, expect, it } from "vitest"

import {
  groupCleanupBySender,
  type CleanupCandidate,
} from "@/lib/agent/sender-cleanup"

function candidate(overrides: Partial<CleanupCandidate> = {}): CleanupCandidate {
  return {
    id: "c1",
    senderEmail: "news@acme.com",
    senderName: "Acme Marketing",
    subject: "Weekend sale",
    emailType: "marketing",
    attentionCategory: "quiet",
    status: "in_progress",
    userState: null,
    hasUnsubscribe: true,
    lastReceivedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  }
}

describe("groupCleanupBySender", () => {
  it("groups conversations by sender email with a count and conversation ids", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", subject: "Sale 1", lastReceivedAt: new Date("2026-07-01") }),
      candidate({ id: "b", subject: "Sale 2", lastReceivedAt: new Date("2026-07-03") }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].senderEmail).toBe("news@acme.com")
    expect(groups[0].count).toBe(2)
    expect(groups[0].conversationIds).toEqual(["a", "b"])
    expect(groups[0].domain).toBe("acme.com")
  })

  it("sorts groups by count descending, then most-recent first", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", senderEmail: "solo@x.com" }),
      candidate({ id: "b", senderEmail: "big@y.com" }),
      candidate({ id: "c", senderEmail: "big@y.com" }),
      candidate({ id: "d", senderEmail: "big@y.com" }),
    ])

    expect(groups.map((g) => g.senderEmail)).toEqual(["big@y.com", "solo@x.com"])
    expect(groups[0].count).toBe(3)
  })

  it("collects up to three distinct sample subjects", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", subject: "One" }),
      candidate({ id: "b", subject: "Two" }),
      candidate({ id: "c", subject: "Two" }),
      candidate({ id: "d", subject: "Three" }),
      candidate({ id: "e", subject: "Four" }),
    ])

    expect(groups[0].sampleSubjects).toEqual(["One", "Two", "Three"])
  })

  it("marks a group unsubscribable when any conversation has an unsubscribe link", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", hasUnsubscribe: false }),
      candidate({ id: "b", hasUnsubscribe: true }),
    ])

    expect(groups[0].hasUnsubscribe).toBe(true)
  })

  it("normalizes sender email case when grouping", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", senderEmail: "News@Acme.com" }),
      candidate({ id: "b", senderEmail: "news@acme.com" }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it("never includes protected conversations (needs reply, waiting, important, receipts)", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "keep-safe", status: "needs_reply" }),
      candidate({ id: "waiting", userState: "waiting_on" }),
      candidate({ id: "vip", attentionCategory: "important" }),
      candidate({ id: "receipt", emailType: "receipt" }),
      candidate({ id: "ok" }),
    ])

    const ids = groups.flatMap((g) => g.conversationIds)
    expect(ids).toEqual(["ok"])
  })

  it("skips conversations without a usable sender email", () => {
    const groups = groupCleanupBySender([
      candidate({ id: "a", senderEmail: null }),
      candidate({ id: "b", senderEmail: "  " }),
      candidate({ id: "c", senderEmail: "not-an-email" }),
    ])

    expect(groups).toEqual([])
  })

  it("returns an empty array for no candidates", () => {
    expect(groupCleanupBySender([])).toEqual([])
  })
})
