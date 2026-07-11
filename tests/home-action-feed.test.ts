import { describe, expect, it } from "vitest"

import {
  buildHomeActionFeed,
  type HomeConversationInput,
  type HomeDeadlineInput,
} from "@/lib/home-action-feed"

function conversation(
  id: string,
  overrides: Partial<HomeConversationInput> = {}
): HomeConversationInput {
  return {
    id,
    title: `Conversation ${id}`,
    subtitle: `Sender ${id}`,
    lastMessageAt: new Date("2026-07-11T10:00:00Z"),
    ...overrides,
  }
}

function deadline(
  taskId: string,
  conversationId: string,
  dueAt: Date
): HomeDeadlineInput {
  return {
    taskId,
    conversationId,
    title: `Task ${taskId}`,
    subtitle: `Due ${dueAt.toISOString()}`,
    href: `/conversations/${conversationId}`,
    dueAt,
  }
}

describe("buildHomeActionFeed", () => {
  it("orders sources and lets the earliest source win conversation deduplication", () => {
    const result = buildHomeActionFeed({
      approvals: [{
        id: "a1",
        conversationId: "c1",
        title: "Approve reply",
        subtitle: "Acme",
        createdAt: new Date("2026-07-11T09:00:00Z"),
      }],
      topActions: [conversation("c1"), conversation("c2")],
      needsAction: [conversation("c3")],
      deadlines: [deadline("t1", "c4", new Date("2026-07-10T10:00:00Z"))],
      followUps: [conversation("c5")],
      now: new Date("2026-07-11T12:00:00Z"),
    })

    expect(result.items.map((item) => item.key)).toEqual([
      "approval:a1",
      "conversation:c2",
      "task:t1",
      "conversation:c3",
      "conversation:c5",
    ])
  })

  it("places overdue deadlines before needs-action and upcoming deadlines after it", () => {
    const result = buildHomeActionFeed({
      approvals: [],
      topActions: [],
      needsAction: [conversation("c-action")],
      deadlines: [
        deadline("upcoming", "c-upcoming", new Date("2026-07-12T12:00:00Z")),
        deadline("overdue", "c-overdue", new Date("2026-07-10T12:00:00Z")),
      ],
      followUps: [],
      now: new Date("2026-07-11T12:00:00Z"),
    })

    expect(result.items.map((item) => item.key)).toEqual([
      "task:overdue",
      "conversation:c-action",
      "task:upcoming",
    ])
  })

  it("deduplicates a task when its conversation already has an action", () => {
    const result = buildHomeActionFeed({
      approvals: [],
      topActions: [conversation("c1")],
      needsAction: [],
      deadlines: [deadline("t1", "c1", new Date("2026-07-10T12:00:00Z"))],
      followUps: [],
      now: new Date("2026-07-11T12:00:00Z"),
    })

    expect(result.items.map((item) => item.key)).toEqual(["conversation:c1"])
  })

  it("computes total before limiting the displayed feed to ten", () => {
    const result = buildHomeActionFeed({
      approvals: [],
      topActions: Array.from({ length: 12 }, (_, index) => conversation(`c${index}`)),
      needsAction: [],
      deadlines: [],
      followUps: [],
      now: new Date("2026-07-11T12:00:00Z"),
    })

    expect(result.total).toBe(12)
    expect(result.items).toHaveLength(10)
  })

  it("keeps approvals review-only and handles empty input", () => {
    const empty = buildHomeActionFeed({
      approvals: [],
      topActions: [],
      needsAction: [],
      deadlines: [],
      followUps: [],
      now: new Date("2026-07-11T12:00:00Z"),
    })
    expect(empty).toEqual({ items: [], total: 0 })

    const approval = buildHomeActionFeed({
      ...emptyInput(),
      approvals: [{
        id: "a1",
        conversationId: null,
        title: "Approve action",
        subtitle: "Needs review",
        createdAt: new Date("2026-07-11T10:00:00Z"),
      }],
    }).items[0]
    expect(approval.canComplete).toBe(false)
  })
})

function emptyInput() {
  return {
    approvals: [],
    topActions: [],
    needsAction: [],
    deadlines: [],
    followUps: [],
    now: new Date("2026-07-11T12:00:00Z"),
  }
}
