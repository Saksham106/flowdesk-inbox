import { describe, expect, it } from "vitest"

import { buildRiskRadar, type RiskRadarInputConversation } from "@/lib/agent/risk-radar"

const NOW = new Date("2026-06-12T12:00:00.000Z")

function message(body: string, createdAt = new Date("2026-06-12T09:00:00.000Z")) {
  return {
    direction: "inbound",
    body,
    createdAt,
  }
}

function conversation(
  overrides: Partial<RiskRadarInputConversation> = {}
): RiskRadarInputConversation {
  return {
    id: "conv-1",
    externalThreadId: "thread-1",
    label: null,
    status: "needs_reply",
    lastMessageAt: new Date("2026-06-12T09:00:00.000Z"),
    contact: { name: "Taylor Lee" },
    channel: { emailAddress: "owner@example.com", type: "gmail" },
    messages: [message("Can you send this by tomorrow?")],
    draft: null,
    ...overrides,
  }
}

describe("buildRiskRadar", () => {
  it("flags inbound deadline-soon language", () => {
    const radar = buildRiskRadar([conversation()], NOW)

    expect(radar.sections.deadlineSoon[0]).toMatchObject({
      conversationId: "conv-1",
      displayName: "Taylor Lee",
      signal: "deadline_soon",
      priority: "urgent",
      reason: "Near-term deadline language detected.",
      nextAction: "Reply or schedule the work before the deadline passes.",
    })
  })

  it("flags final notice and payment interruption language", () => {
    const radar = buildRiskRadar(
      [
        conversation({
          messages: [message("Final notice: your account is past due and may be suspended.", NOW)],
        }),
      ],
      NOW
    )

    expect(radar.sections.finalNotices).toHaveLength(1)
    expect(radar.sections.finalNotices[0]).toMatchObject({
      signal: "final_notice",
      priority: "urgent",
      reason: "Final notice or service interruption language detected.",
      nextAction: "Review the notice and respond or pay before service is interrupted.",
    })
  })

  it("flags unanswered inbound needs-reply threads after three days", () => {
    const radar = buildRiskRadar(
      [
        conversation({
          lastMessageAt: new Date("2026-06-08T12:00:00.000Z"),
          messages: [message("Are you there?", new Date("2026-06-08T12:00:00.000Z"))],
        }),
      ],
      NOW
    )

    expect(radar.sections.unanswered[0]).toMatchObject({
      signal: "unanswered",
      priority: "high",
      ageInDays: 4,
      reason: "Inbound thread has waited 4 days without a reply.",
    })
  })

  it("does not flag closed or outbound-latest conversations as unanswered", () => {
    const radar = buildRiskRadar(
      [
        conversation({
          id: "closed",
          status: "closed",
          lastMessageAt: new Date("2026-06-01T12:00:00.000Z"),
          messages: [message("Please reply.", new Date("2026-06-01T12:00:00.000Z"))],
        }),
        conversation({
          id: "outbound",
          lastMessageAt: new Date("2026-06-01T12:00:00.000Z"),
          messages: [
            {
              direction: "outbound",
              body: "Following up with you.",
              createdAt: new Date("2026-06-01T12:00:00.000Z"),
            },
          ],
        }),
      ],
      NOW
    )

    expect(radar.sections.unanswered).toHaveLength(0)
  })

  it("flags sensitive draft metadata and sensitive message text", () => {
    const radar = buildRiskRadar(
      [
        conversation({
          draft: { metadataJson: { riskLevel: "high", escalationReason: "Legal issue" } },
        }),
        conversation({
          id: "conv-2",
          externalThreadId: "thread-2",
          contact: { name: "Jordan Patel" },
          messages: [message("Need help with an immigration contract dispute.")],
        }),
      ],
      NOW
    )

    expect(radar.sections.sensitive.map((item) => item.conversationId)).toEqual([
      "conv-1",
      "conv-2",
    ])
    expect(radar.sections.sensitive[0].reason).toBe("Legal issue")
  })

  it("sorts urgent items before older high-priority items and counts unique risky conversations", () => {
    const radar = buildRiskRadar(
      [
        conversation(),
        conversation({
          id: "conv-2",
          externalThreadId: "thread-2",
          lastMessageAt: new Date("2026-06-01T12:00:00.000Z"),
          messages: [message("Please reply when you can.", new Date("2026-06-01T12:00:00.000Z"))],
        }),
      ],
      NOW
    )

    expect(radar.totalRiskyConversations).toBe(2)
    expect(radar.counts).toMatchObject({
      deadlineSoon: 1,
      finalNotices: 0,
      unanswered: 1,
      sensitive: 0,
    })
    expect(radar.items[0].priority).toBe("urgent")
    expect(radar.items[0].conversationId).toBe("conv-1")
  })
})
