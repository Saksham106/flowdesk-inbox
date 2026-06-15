import { describe, expect, it } from "vitest"

import {
  analyzeConversationForCommandCenter,
  buildDailyCommandCenter,
  buildRelationshipContext,
  type CommandCenterInputConversation,
  type PersistedCommandCenterState,
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

describe("emailType override in analyzeConversationForCommandCenter", () => {
  it("classifies notification emailType as fyi_only", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({ status: "needs_reply", conversationState: { metadataJson: { emailType: "notification" } } }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.priority).toBe("none")
    expect(result.reason).toContain("Automated notification")
    expect(result.safelyIgnored).toBe(true)
  })

  it("classifies newsletter emailType as fyi_only with unsubscribe hint", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({ status: "needs_reply", conversationState: { metadataJson: { emailType: "newsletter" } } }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.priority).toBe("none")
    expect(result.reason).toContain("Newsletter")
    expect(result.nextAction).toContain("Unsubscribe")
    expect(result.safelyIgnored).toBe(true)
  })

  it("classifies marketing emailType as fyi_only", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({ status: "needs_reply", conversationState: { metadataJson: { emailType: "marketing" } } }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.priority).toBe("none")
    expect(result.reason).toContain("Marketing")
    expect(result.safelyIgnored).toBe(true)
  })

  it("sensitive flag still overrides auto-email classification", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        label: "Complaint",
        conversationState: { metadataJson: { emailType: "notification" } },
        messages: [{ direction: "inbound", body: "legal dispute refund", createdAt: now }],
      }),
      now
    )
    expect(result.state).toBe("risky_urgent")
  })
})

describe("needsAction flag", () => {
  it("is true when attentionCategory is needs_action", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { attentionCategory: "needs_action", emailType: "notification" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.needsAction).toBe(true)
  })

  it("is false when attentionCategory is needs_reply", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { attentionCategory: "needs_reply" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.needsAction).toBe(false)
  })

  it("is false when no attentionCategory is set", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.needsAction).toBe(false)
  })
})

describe("readLater flag", () => {
  it("is true when attentionCategory is read_later", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { attentionCategory: "read_later" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.readLater).toBe(true)
  })

  it("is false when attentionCategory is not read_later", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.readLater).toBe(false)
  })
})

describe("emailType field", () => {
  it("returns the emailType from metadataJson", () => {
    const conv = conversation({
      conversationState: {
        metadataJson: { emailType: "newsletter", attentionCategory: "quiet" },
      },
    })
    const result = analyzeConversationForCommandCenter(conv, now)
    expect(result.emailType).toBe("newsletter")
  })

  it("returns null when no emailType in metadataJson", () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.emailType).toBeNull()
  })
})

describe("buildDailyCommandCenter new sections", () => {
  it("populates sections.needsAction and counts.needsAction", () => {
    const actionConv = conversation({
      id: "action-1",
      conversationState: {
        metadataJson: { attentionCategory: "needs_action" },
      },
    })
    const result = buildDailyCommandCenter([actionConv, conversation({ id: "normal-1" })], now)
    expect(result.sections.needsAction).toHaveLength(1)
    expect(result.sections.needsAction[0].id).toBe("action-1")
    expect(result.counts.needsAction).toBe(1)
  })

  it("populates sections.readLater and counts.readLater", () => {
    const readLaterConv = conversation({
      id: "rl-1",
      conversationState: {
        metadataJson: { attentionCategory: "read_later" },
      },
    })
    const result = buildDailyCommandCenter([readLaterConv, conversation({ id: "normal-1" })], now)
    expect(result.sections.readLater).toHaveLength(1)
    expect(result.sections.readLater[0].id).toBe("rl-1")
    expect(result.counts.readLater).toBe(1)
  })

  it("does not duplicate a pure action email between Handle First and Needs Action", () => {
    const multiBucket = conversation({
      id: "multi-1",
      conversationState: {
        metadataJson: { attentionCategory: "needs_action" },
      },
    })

    const result = buildDailyCommandCenter([multiBucket], now)

    expect(result.topActions).toHaveLength(0)
    expect(result.sections.needsAction.map((item) => item.id)).toEqual(["multi-1"])
    expect(result.sections.readLater).toHaveLength(0)
    expect(result.sections.safelyIgnored).toHaveLength(0)
  })

  it("computes quietlyHandledBreakdown from safelyIgnored emails", () => {
    const newsletter = conversation({
      id: "nl-1",
      conversationState: {
        metadataJson: { emailType: "newsletter", attentionCategory: "quiet" },
      },
    })
    const notification = conversation({
      id: "notif-1",
      conversationState: {
        metadataJson: { emailType: "notification", attentionCategory: "quiet" },
      },
    })
    const result = buildDailyCommandCenter([newsletter, notification], now)
    expect(result.quietlyHandledBreakdown.newsletter).toBe(1)
    expect(result.quietlyHandledBreakdown.notification).toBe(1)
    expect(result.quietlyHandledBreakdown.marketing).toBe(0)
    expect(result.quietlyHandledBreakdown.other).toBe(0)
  })
})

describe("buildDailyCommandCenter with persisted states", () => {
  function makePersistedState(overrides: Partial<PersistedCommandCenterState> = {}): PersistedCommandCenterState {
    return {
      conversationId: "conv-1",
      state: "needs_reply",
      priority: "high",
      reason: "Needs your reply.",
      nextAction: "Draft a reply.",
      confidence: 0.75,
      source: "deterministic",
      metadataJson: {},
      updatedAt: now,
      ...overrides,
    }
  }

  it("uses persisted state when fresh", () => {
    const persisted = makePersistedState({
      conversationId: "conv-persisted",
      state: "opportunity",
      priority: "high",
      reason: "Potential revenue opportunity.",
      nextAction: "Draft a reply and move the opportunity forward.",
    })

    const persistedStates = new Map<string, PersistedCommandCenterState>([
      ["conv-persisted", persisted],
    ])

    const result = buildDailyCommandCenter(
      [
        conversation({ id: "conv-persisted", status: "needs_reply" }),
        conversation({ id: "conv-fresh", status: "needs_reply" }),
      ],
      now,
      "business",
      persistedStates
    )

    // Persisted conversation should use persisted state
    const persistedResult = result.conversations.find((c) => c.id === "conv-persisted")
    expect(persistedResult?.state).toBe("opportunity")
    expect(persistedResult?.reason).toBe("Potential revenue opportunity.")

    // Fresh conversation should be analyzed normally
    const freshResult = result.conversations.find((c) => c.id === "conv-fresh")
    expect(freshResult?.state).toBe("needs_reply")
  })

  it("ignores stale persisted state and re-analyzes", () => {
    const staleNow = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 hours later
    const persisted = makePersistedState({
      conversationId: "conv-stale",
      updatedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago (stale)
      state: "fyi_only",
      priority: "none",
      reason: "Safely ignored for now.",
      nextAction: "No action needed.",
    })

    const persistedStates = new Map<string, PersistedCommandCenterState>([
      ["conv-stale", persisted],
    ])

    const result = buildDailyCommandCenter(
      [
        conversation({ id: "conv-stale", status: "needs_reply" }),
      ],
      staleNow,
      "business",
      persistedStates
    )

    // Should re-analyze because state is stale, not use persisted fyi_only
    const analyzed = result.conversations[0]
    expect(analyzed.state).toBe("needs_reply")
    expect(analyzed.priority).toBe("high")
  })

  it("uses persisted state for done/fyi_only conversations correctly", () => {
    const persisted = makePersistedState({
      conversationId: "conv-done",
      state: "done",
      priority: "none",
      reason: "Conversation is done.",
      nextAction: "No action needed.",
    })

    const persistedStates = new Map<string, PersistedCommandCenterState>([
      ["conv-done", persisted],
    ])

    const result = buildDailyCommandCenter(
      [
        conversation({ id: "conv-done", status: "closed" }),
      ],
      now,
      "business",
      persistedStates
    )

    const analyzed = result.conversations[0]
    expect(analyzed.state).toBe("done")
    expect(analyzed.safelyIgnored).toBe(true)
    expect(analyzed.needsReply).toBe(false)
  })

  it("lets an explicit closed user state beat fresh persisted AI state", () => {
    const persisted = makePersistedState({
      conversationId: "conv-closed",
      state: "needs_reply",
      priority: "high",
      reason: "Old AI state",
      nextAction: "Draft a reply.",
    })

    const result = buildDailyCommandCenter(
      [
        conversation({ id: "conv-closed", status: "closed" }),
      ],
      now,
      "business",
      new Map([["conv-closed", persisted]])
    )

    expect(result.topActions).toHaveLength(0)
    expect(result.sections.needsReply).toHaveLength(0)
    expect(result.sections.safelyIgnored.map((item) => item.id)).toEqual(["conv-closed"])
    expect(result.conversations[0].state).toBe("done")
  })
})
