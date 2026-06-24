import { describe, expect, it } from "vitest"

import {
  buildConversationStateDraft,
  extractInboxTaskDrafts,
  extractLeadDraft,
  summarizeWorkItems,
  type WorkItemConversationInput,
} from "@/lib/agent/work-items"

const now = new Date("2026-06-11T14:00:00.000Z")

function conversation(overrides: Partial<WorkItemConversationInput> = {}): WorkItemConversationInput {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    externalThreadId: "thread-1",
    label: null,
    status: "needs_reply",
    lastMessageAt: new Date("2026-06-11T13:00:00.000Z"),
    contact: { name: "Sarah Patel", phoneE164: "sarah@example.com" },
    channel: { emailAddress: "owner@example.com", type: "email" },
    messages: [
      {
        id: "msg-1",
        direction: "inbound",
        body: "Can you send the notes by Friday?",
        createdAt: new Date("2026-06-11T13:00:00.000Z"),
      },
    ],
    draft: null,
    approvalRequests: [],
    calendarHolds: [],
    ...overrides,
  }
}

describe("extractInboxTaskDrafts", () => {
  it("extracts a promise/deadline task from an inbound request", () => {
    const tasks = extractInboxTaskDrafts(conversation(), now)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      title: "Send the notes",
      status: "open",
      source: "deterministic",
      sourceMessageId: "msg-1",
      deterministicKey: "conv-1:msg-1:send",
    })
    expect(tasks[0].dueAt?.toISOString()).toBe("2026-06-12T16:00:00.000Z")
  })

  it("extracts an invoice/payment task", () => {
    const tasks = extractInboxTaskDrafts(
      conversation({
        messages: [
          {
            id: "msg-pay",
            direction: "inbound",
            body: "Invoice #481 is due June 20. Please pay the $49.99 renewal before then.",
            createdAt: now,
          },
        ],
      }),
      now
    )

    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe("Pay invoice or renewal")
    expect(tasks[0].metadata.amount).toBe("$49.99")
    expect(tasks[0].dueAt?.toISOString()).toBe("2026-06-20T16:00:00.000Z")
  })

  it("does not create tasks for FYI-only messages", () => {
    const tasks = extractInboxTaskDrafts(
      conversation({
        messages: [
          {
            id: "msg-fyi",
            direction: "inbound",
            body: "FYI newsletter for your records. No action needed.",
            createdAt: now,
          },
        ],
      })
    )

    expect(tasks).toEqual([])
  })
})

describe("extractLeadDraft", () => {
  it("extracts a lead from pricing and demo language", () => {
    const lead = extractLeadDraft(
      conversation({
        label: "Lead",
        messages: [
          {
            id: "msg-lead",
            direction: "inbound",
            body: "Hi, this is ABC Dental. Can you help us set up missed call SMS follow-up? What do you charge and can we book a demo next week? Budget is flexible.",
            createdAt: now,
          },
        ],
      })
    )

    expect(lead).toMatchObject({
      name: "Sarah Patel",
      company: "ABC Dental",
      need: "Asked about setup, pricing, or booking.",
      urgency: "high",
      budgetClue: "Budget mentioned",
      stage: "new",
      nextAction: "Draft a reply and ask for the next qualifying detail.",
      source: "deterministic",
    })
    expect(lead?.score).toBeGreaterThanOrEqual(80)
  })

  it("does not extract a lead from FYI newsletter language", () => {
    const lead = extractLeadDraft(
      conversation({
        messages: [
          {
            id: "msg-news",
            direction: "inbound",
            body: "Monthly newsletter: product updates and community news.",
            createdAt: now,
          },
        ],
      })
    )

    expect(lead).toBeNull()
  })
})

describe("buildConversationStateDraft", () => {
  it("builds a persistence payload from command-center analysis", () => {
    const state = buildConversationStateDraft(conversation(), now)

    expect(state).toMatchObject({
      conversationId: "conv-1",
      state: "needs_reply",
      priority: "high",
      source: "deterministic",
      confidence: 0.75,
    })
    expect(state.reason).toContain("Needs your reply")
    expect(state.nextAction).toContain("Draft")
  })
})

describe("summarizeWorkItems", () => {
  it("summarizes extracted tasks and leads", () => {
    const summary = summarizeWorkItems(
      conversation({
        label: "Lead",
        messages: [
          {
            id: "msg-lead",
            direction: "inbound",
            body: "ABC Dental asked for pricing and a demo by Friday.",
            createdAt: now,
          },
        ],
      }),
      now
    )

    expect(summary.tasks).toHaveLength(1)
    expect(summary.lead?.company).toBe("ABC Dental")
    expect(summary.state.state).toBe("opportunity")
  })
})
