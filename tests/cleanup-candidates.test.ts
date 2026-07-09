import { describe, expect, it } from "vitest"
import { summarizeCleanupCandidates } from "@/lib/cleanup-candidates"
import type { CleanupCandidate } from "@/lib/agent/sender-cleanup"

function candidate(overrides: Partial<CleanupCandidate> = {}): CleanupCandidate {
  return {
    id: overrides.id ?? "c1",
    senderEmail: overrides.senderEmail ?? "news@example.com",
    senderName: overrides.senderName ?? "News",
    subject: overrides.subject ?? "Weekly update",
    emailType: overrides.emailType ?? "newsletter",
    attentionCategory: overrides.attentionCategory ?? "quiet",
    status: overrides.status ?? "in_progress",
    userState: overrides.userState ?? null,
    hasUnsubscribe: overrides.hasUnsubscribe ?? true,
    lastReceivedAt: overrides.lastReceivedAt ?? new Date("2026-07-09T12:00:00.000Z"),
  }
}

describe("summarizeCleanupCandidates", () => {
  it("returns safe groups, unsubscribe groups, and analytics from one candidate set", () => {
    const result = summarizeCleanupCandidates([
      candidate({ id: "one", emailType: "newsletter", hasUnsubscribe: true }),
      candidate({ id: "two", senderEmail: "promo@example.com", emailType: "marketing", hasUnsubscribe: false }),
      candidate({ id: "protected", status: "needs_reply", emailType: "marketing" }),
    ])

    expect(result.groups).toHaveLength(2)
    expect(result.unsubscribeGroups).toHaveLength(1)
    expect(result.analytics.totalCleanable).toBe(2)
    expect(result.analytics.protectedOrSkipped).toBe(1)
    expect(result.analytics.noUnsubscribeLinkCount).toBe(1)
    expect(result.analytics.byEmailType).toEqual([
      ["marketing", 1],
      ["newsletter", 1],
    ])
  })
})
