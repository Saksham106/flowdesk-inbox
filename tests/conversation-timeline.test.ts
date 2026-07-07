import { describe, expect, it } from "vitest"

import {
  buildConversationTimeline,
  type TimelineAuditRow,
} from "@/lib/agent/conversation-timeline"

function row(overrides: Partial<TimelineAuditRow> = {}): TimelineAuditRow {
  return {
    id: "audit-1",
    action: "agent_job.completed",
    createdAt: new Date("2026-07-06T12:00:00.000Z"),
    payloadJson: {},
    userEmail: null,
    ...overrides,
  }
}

describe("buildConversationTimeline", () => {
  it("returns entries newest-first regardless of input order", () => {
    const older = row({
      id: "a",
      action: "draft.suggest",
      createdAt: new Date("2026-07-06T10:00:00.000Z"),
    })
    const newer = row({
      id: "b",
      action: "draft.sent",
      createdAt: new Date("2026-07-06T11:00:00.000Z"),
    })

    const entries = buildConversationTimeline([older, newer])

    expect(entries.map((e) => e.id)).toEqual(["b", "a"])
  })

  it("explains a static-rule classification with rule id, version, and evidence", () => {
    const entries = buildConversationTimeline([
      row({
        action: "agent_job.completed",
        payloadJson: {
          conversationId: "conv-1",
          intent: "newsletter",
          confidence: 1,
          classificationSource: "static_rule",
          ruleSource: "agent_rule",
          ruleId: "rule-42",
          ruleVersion: 3,
          ruleEvidence: ["sender domain is news.example.com"],
        },
      }),
    ])

    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry.title).toMatch(/classified/i)
    expect(entry.why).toEqual({
      kind: "rule",
      ruleSource: "agent_rule",
      ruleId: "rule-42",
      ruleVersion: 3,
      evidence: ["sender domain is news.example.com"],
    })
  })

  it("explains an LLM classification with confidence", () => {
    const [entry] = buildConversationTimeline([
      row({
        action: "agent_job.completed",
        payloadJson: {
          conversationId: "conv-1",
          intent: "support_request",
          confidence: 0.82,
          classificationSource: "llm",
        },
      }),
    ])

    expect(entry.why).toEqual({ kind: "ai", confidence: 0.82, intent: "support_request" })
  })

  it("renders a Gmail label writeback with the applied labels", () => {
    const [entry] = buildConversationTimeline([
      row({
        action: "gmail.writeback.completed",
        payloadJson: {
          conversationId: "conv-1",
          action: "apply_labels",
          result: "applied 2 labels",
          labels: ["FlowDesk/Needs Reply", "FlowDesk/Waiting On"],
        },
      }),
    ])

    expect(entry.tone).toBe("success")
    expect(entry.detail).toContain("FlowDesk/Needs Reply")
  })

  it("marks a failed writeback as danger and surfaces the error", () => {
    const [entry] = buildConversationTimeline([
      row({
        action: "gmail.writeback.failed",
        payloadJson: {
          conversationId: "conv-1",
          action: "mark_read",
          result: "failed",
          error: "insufficient permissions",
          attempts: 5,
        },
      }),
    ])

    expect(entry.tone).toBe("danger")
    expect(entry.detail).toContain("insufficient permissions")
  })

  it("labels a user correction as a manual action", () => {
    const [entry] = buildConversationTimeline([
      row({
        action: "conversation.attention_corrected",
        userEmail: "owner@example.com",
        payloadJson: { conversationId: "conv-1" },
      }),
    ])

    expect(entry.why).toEqual({ kind: "manual", by: "owner@example.com" })
    expect(entry.tone).toBe("info")
  })

  it("omits audit rows that are not meaningful thread actions", () => {
    const entries = buildConversationTimeline([
      row({ action: "conversation_state.synced", payloadJson: { conversationId: "conv-1" } }),
      row({ action: "person_memory.synced", payloadJson: { conversationId: "conv-1" } }),
    ])

    expect(entries).toEqual([])
  })

  it("recognizes the waiting-on lifecycle transitions", () => {
    const entries = buildConversationTimeline([
      row({
        id: "w1",
        action: "conversation.waiting_on_detected",
        createdAt: new Date("2026-07-06T09:00:00.000Z"),
        payloadJson: { conversationId: "conv-1" },
      }),
      row({
        id: "w2",
        action: "conversation.waiting_on_cleared",
        createdAt: new Date("2026-07-06T10:00:00.000Z"),
        payloadJson: { conversationId: "conv-1" },
      }),
      row({
        id: "w3",
        action: "follow_up.due_labeled",
        createdAt: new Date("2026-07-06T11:00:00.000Z"),
        payloadJson: { conversationId: "conv-1" },
      }),
    ])

    expect(entries.map((e) => e.title.toLowerCase())).toEqual([
      expect.stringContaining("follow"),
      expect.stringContaining("reply"),
      expect.stringContaining("waiting"),
    ])
    expect(entries.find((e) => e.id === "w3")?.tone).toBe("warning")
  })
})
