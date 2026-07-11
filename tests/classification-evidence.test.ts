import { describe, expect, it } from "vitest"

import { buildClassificationEvidence } from "@/lib/agent/classification-evidence"

describe("buildClassificationEvidence", () => {
  it("captures newsletter evidence from List-Unsubscribe content", () => {
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "Product Updates <news@updates.example.com>",
        body: "List-Unsubscribe: <https://updates.example.com/unsubscribe>\nThis week's release notes.",
        createdAt: new Date("2026-07-10T09:00:00Z"),
      }],
    })

    expect(evidence.sender).toEqual({ email: "news@updates.example.com", domain: "updates.example.com" })
    expect(evidence.unsubscribe).toBe(true)
    expect(evidence.deterministicSignals).toContain("list_unsubscribe")
  })

  it("does not treat an ordinary body mention of unsubscribe as List-Unsubscribe evidence", () => {
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "Alex <alex@example.com>",
        body: "Could you unsubscribe me from the gym mailing list when you have a moment?",
        createdAt: new Date("2026-07-10T09:00:00Z"),
      }],
    })

    expect(evidence.unsubscribe).toBe(false)
    expect(evidence.deterministicSignals).not.toContain("list_unsubscribe")
  })

  it("caps oversized inbound bodies before retaining classification evidence", () => {
    const body = `${"a".repeat(12_000)} UNIQUE_TRAILING_CONTENT`
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "Alex <alex@example.com>",
        body,
        createdAt: new Date("2026-07-10T09:00:00Z"),
      }],
    })

    expect(evidence.latestInbound?.body.length).toBeLessThanOrEqual(2_000)
    expect(evidence.recentReciprocalReplies[0]?.body.length).toBeLessThanOrEqual(800)
    expect(JSON.stringify(evidence)).not.toContain("UNIQUE_TRAILING_CONTENT")
  })

  it("captures calendar and notification header evidence", () => {
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "Calendar <calendar@example.com>",
        body: "Content-Type: text/calendar\nBEGIN:VCALENDAR\nMETHOD:REQUEST\nEND:VCALENDAR",
        createdAt: new Date("2026-07-10T09:00:00Z"),
      }, {
        direction: "inbound",
        fromE164: "GitHub <noreply@github.com>",
        body: "X-GitHub-Event: push\nA commit was pushed.",
        createdAt: new Date("2026-07-10T10:00:00Z"),
      }],
    })

    expect(evidence.calendarInvite).toBe(true)
    expect(evidence.notificationHeaders).toContain("x-github-event")
  })

  it("uses the latest meaningful inbound message and includes recent reciprocal replies", () => {
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "Alex <alex@example.com>",
        body: "Can we meet next week?",
        createdAt: new Date("2026-07-08T09:00:00Z"),
      }, {
        direction: "outbound",
        fromE164: "me@example.com",
        body: "Tuesday works for me.",
        createdAt: new Date("2026-07-08T10:00:00Z"),
      }, {
        direction: "inbound",
        fromE164: "Alex <alex@example.com>",
        body: "\n\n",
        createdAt: new Date("2026-07-08T11:00:00Z"),
      }, {
        direction: "inbound",
        fromE164: "Alex <alex@example.com>",
        body: "Thursday afternoon is perfect.",
        createdAt: new Date("2026-07-08T12:00:00Z"),
      }],
    })

    expect(evidence.latestInbound?.body).toBe("Thursday afternoon is perfect.")
    expect(evidence.recentReciprocalReplies).toEqual([
      { direction: "inbound", body: "Can we meet next week?" },
      { direction: "outbound", body: "Tuesday works for me." },
      { direction: "inbound", body: "Thursday afternoon is perfect." },
    ])
  })

  it("includes prior correction, learned rule, and Gmail override evidence", () => {
    const evidence = buildClassificationEvidence({
      messages: [{
        direction: "inbound",
        fromE164: "News <news@example.com>",
        body: "Update",
        createdAt: new Date("2026-07-10T09:00:00Z"),
      }],
      stateRecord: {
        source: "gmail_label",
        attentionCategory: "read_later",
        emailType: "newsletter",
        metadataJson: {
          attentionCorrectedByUser: true,
          attentionCategory: "read_later",
          learnedRuleId: "rule-42",
          gmailLabelOverride: { workflow: "Read Later", contentType: null, updatedAt: "2026-07-10T09:00:00Z" },
        },
      },
    })

    expect(evidence.priorCorrection).toEqual({ attentionCategory: "read_later", emailType: "newsletter" })
    expect(evidence.priorRuleEvidence).toContain("rule-42")
    expect(evidence.hasGmailOverride).toBe(true)
  })
})
