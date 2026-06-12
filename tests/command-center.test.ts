import { describe, expect, it } from "vitest"

import {
  analyzeConversationForCommandCenter,
  buildDailyCommandCenter,
  buildRelationshipContext,
  type CommandCenterInputConversation,
} from "@/lib/agent/command-center"

const now = new Date("2026-06-11T14:00:00.000Z")

function conversation(
  overrides: Partial<CommandCenterInputConversation> = {}
): CommandCenterInputConversation {
  return {
    id: "conv-1",
    externalThreadId: "sarah@example.com",
    label: null,
    status: "needs_reply",
    lastMessageAt: new Date("2026-06-11T12:00:00.000Z"),
    contact: { name: "Sarah Patel", phoneE164: "sarah@example.com" },
    channel: { emailAddress: "owner@example.com", type: "email" },
    messages: [
      {
        direction: "inbound",
        body: "Can you send the notes by 3 PM?",
        createdAt: new Date("2026-06-11T12:00:00.000Z"),
      },
    ],
    draft: null,
    agentJobs: [],
    approvalRequests: [],
    calendarHolds: [],
    ...overrides,
  }
}

describe("analyzeConversationForCommandCenter", () => {
  it("prioritizes inbound conversations that need a reply", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)

    expect(result.state).toBe("needs_reply")
    expect(result.priority).toBe("high")
    expect(result.reason).toContain("Needs your reply")
    expect(result.nextAction).toContain("Draft")
  })

  it("detects waiting on them after an outbound question goes stale", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "in_progress",
        lastMessageAt: new Date("2026-06-07T12:00:00.000Z"),
        messages: [
          {
            direction: "outbound",
            body: "Can you confirm whether Thursday works?",
            createdAt: new Date("2026-06-07T12:00:00.000Z"),
          },
        ],
      }),
      now
    )

    expect(result.state).toBe("waiting_on_them")
    expect(result.reason).toContain("waiting on them")
    expect(result.nextAction).toContain("follow-up")
  })

  it("flags sensitive money or legal conversations for review", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        label: "Complaint",
        messages: [
          {
            direction: "inbound",
            body: "This refund dispute may become a legal issue if unpaid.",
            createdAt: now,
          },
        ],
        draft: {
          metadataJson: {
            riskLevel: "high",
            escalationReason: "Refund dispute with legal language",
            confidence: 0.72,
          },
        },
      }),
      now
    )

    expect(result.state).toBe("risky_urgent")
    expect(result.priority).toBe("urgent")
    expect(result.sensitive).toBe(true)
    expect(result.approvalReason).toContain("Refund dispute")
  })

  it("marks active calendar holds as scheduled", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "in_progress",
        calendarHolds: [
          {
            status: "held",
            startAt: new Date("2026-06-12T15:00:00.000Z"),
            expiresAt: new Date("2026-06-11T18:00:00.000Z"),
          },
        ],
      }),
      now
    )

    expect(result.state).toBe("scheduled")
    expect(result.reason).toContain("Calendar hold")
  })

  it("marks closed conversations as safely ignored", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "closed",
        messages: [
          {
            direction: "inbound",
            body: "Thanks, all set.",
            createdAt: now,
          },
        ],
      }),
      now
    )

    expect(result.state).toBe("done")
    expect(result.safelyIgnored).toBe(true)
  })
})

describe("buildDailyCommandCenter", () => {
  it("summarizes the important work for today", () => {
    const briefing = buildDailyCommandCenter(
      [
        conversation({ id: "reply", status: "needs_reply" }),
        conversation({
          id: "lead",
          label: "Lead",
          messages: [
            {
              direction: "inbound",
              body: "How much do you charge and can we book a demo?",
              createdAt: now,
            },
          ],
        }),
        conversation({
          id: "done",
          status: "closed",
          messages: [
            {
              direction: "inbound",
              body: "Newsletter update for your records.",
              createdAt: now,
            },
          ],
        }),
      ],
      now
    )

    expect(briefing.headline).toBe("Here are the 2 things that actually matter today.")
    expect(briefing.counts.needsReply).toBe(2)
    expect(briefing.counts.opportunities).toBe(1)
    expect(briefing.counts.safelyIgnored).toBe(1)
    expect(briefing.topActions.map((item) => item.id)).toEqual(["lead", "reply"])
  })

  it("celebrates zero dropped balls when nothing actionable is open", () => {
    const briefing = buildDailyCommandCenter(
      [
        conversation({ id: "closed", status: "closed" }),
        conversation({
          id: "fyi",
          status: "in_progress",
          messages: [
            {
              direction: "inbound",
              body: "FYI newsletter for later.",
              createdAt: now,
            },
          ],
        }),
      ],
      now
    )

    expect(briefing.droppedBallMessage).toBe("You have 0 dropped balls.")
    expect(briefing.topActions).toHaveLength(0)
  })
})

describe("sales_qualified state", () => {
  it("classifies conversation as sales_qualified when isSalesLead is true in metadataJson", () => {
    const conv = conversation({
      id: "sales-1",
      status: "needs_reply",
      conversationState: {
        metadataJson: {
          isSalesLead: true,
          closingStage: "proposal",
        },
      },
    })

    const analyzed = analyzeConversationForCommandCenter(conv, now)
    expect(analyzed.state).toBe("sales_qualified")

    const result = buildDailyCommandCenter([conv], now)
    expect(result.sections.salesQualified).toHaveLength(1)
    expect(result.sections.salesQualified[0].id).toBe("sales-1")
    expect(result.counts.salesQualified).toBe(1)
  })
})

describe("buildRelationshipContext", () => {
  it("extracts person context and business signals", () => {
    const context = buildRelationshipContext(
      conversation({
        label: "Lead",
        messages: [
          {
            direction: "inbound",
            body: "We are ABC Dental. Budget is tight, but we want pricing and a demo next week.",
            createdAt: new Date("2026-06-10T15:00:00.000Z"),
          },
          {
            direction: "outbound",
            body: "I promised to send setup options by Friday.",
            createdAt: new Date("2026-06-10T16:00:00.000Z"),
          },
        ],
        draft: {
          metadataJson: {
            intent: "pricing and demo request",
            riskLevel: "low",
            suggestedLabel: "Lead",
          },
        },
      }),
      now
    )

    expect(context.name).toBe("Sarah Patel")
    expect(context.relationshipStatus).toBe("Opportunity")
    expect(context.moneySignals).toContain("pricing")
    expect(context.openTasks[0]).toContain("Send")
    expect(context.lastConversationSummary).toContain("pricing and demo request")
  })
})

describe('estimatedValue in CommandCenterConversation', () => {
  it('populates estimatedValue from lead when conversation is an opportunity', () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        label: 'Lead',
        lead: { score: 55, scoreExplanation: 'High intent', estimatedValue: 3000 },
      }),
      now
    )
    expect(result.estimatedValue).toBe(3000)
  })

  it('sets estimatedValue to null when no lead exists', () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.estimatedValue).toBeNull()
  })
})

describe('revenue-weighted score()', () => {
  it('a high-value opportunity outranks a zero-value opportunity in topActions', () => {
    const highValue = conversation({
      id: 'conv-high',
      label: 'Lead',
      lead: { score: 60, scoreExplanation: 'Budget confirmed', estimatedValue: 10000 },
    })
    const noValue = conversation({
      id: 'conv-low',
      label: 'Lead',
      lead: { score: 60, scoreExplanation: 'Inquiry only', estimatedValue: 0 },
    })
    const center = buildDailyCommandCenter([highValue, noValue], now)
    const ids = center.topActions.map((a) => a.id)
    expect(ids.indexOf('conv-high')).toBeLessThan(ids.indexOf('conv-low'))
  })

  it('null estimatedValue does not corrupt sort order', () => {
    const withNull = conversation({ id: 'null-val', label: 'Lead', lead: { score: 60, scoreExplanation: 'x', estimatedValue: null } })
    const withZero = conversation({ id: 'zero-val', label: 'Lead', lead: { score: 60, scoreExplanation: 'x', estimatedValue: 0 } })
    const center = buildDailyCommandCenter([withNull, withZero], now)
    expect(center.topActions).toHaveLength(2)
    expect(center.topActions.every(a => a.estimatedValue !== undefined)).toBe(true)
  })
})
