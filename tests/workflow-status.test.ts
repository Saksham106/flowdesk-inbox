import { describe, it, expect } from "vitest"
import {
  deriveWorkflowStatus,
  aiCategoryLabel,
} from "@/lib/workflow-status"
import {
  conversationUpdateForDraftReady,
  conversationUpdateForWorkflowStatus,
} from "@/lib/workflow-status-transitions"

describe("deriveWorkflowStatus", () => {
  it("returns draft_ready when draft is proposed and no manual userState is set", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, draftStatus: "proposed" })).toBe("draft_ready")
  })
  it("userState=done wins over proposed draft (manual choice persists)", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "done", draftStatus: "proposed" })).toBe("done")
  })
  it("userState=waiting_on wins over proposed draft", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "waiting_on", draftStatus: "proposed" })).toBe("waiting_on")
  })
  it("respects userState=waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "waiting_on" })).toBe("waiting_on")
  })
  it("respects userState=read_later", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "read_later" })).toBe("read_later")
  })
  it("respects userState=done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "done" })).toBe("done")
  })
  it("falls through to derive when userState=needs_reply (reset)", () => {
    expect(deriveWorkflowStatus({ status: "closed", userState: "needs_reply" })).toBe("done")
  })
  it("attentionCategory=waiting_on → waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "waiting_on" })).toBe("waiting_on")
  })
  it("attentionCategory=review_soon → read_later instead of falling through to needs_reply", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "review_soon" })).toBe("read_later")
  })
  it("a closed review_soon conversation stays done (status ranks above review_soon)", () => {
    expect(deriveWorkflowStatus({ status: "closed", userState: null, attentionCategory: "review_soon" })).toBe("done")
  })
  it("attentionCategory=read_later → read_later", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "read_later" })).toBe("read_later")
  })
  it("attentionCategory=fyi_done → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "fyi_done" })).toBe("done")
  })
  it("attentionCategory=quiet → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, attentionCategory: "quiet" })).toBe("done")
  })
  it("status=closed → done", () => {
    expect(deriveWorkflowStatus({ status: "closed", userState: null })).toBe("done")
  })
  it("status=in_progress → waiting_on", () => {
    expect(deriveWorkflowStatus({ status: "in_progress", userState: null })).toBe("waiting_on")
  })
  it("emailType=newsletter → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "newsletter" })).toBe("done")
  })
  it("emailType=notification → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "notification" })).toBe("done")
  })
  it("emailType=marketing → done", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null, emailType: "marketing" })).toBe("done")
  })
  it("defaults to needs_reply", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: null })).toBe("needs_reply")
  })
  it("userState=needs_reply with no other signals defaults to needs_reply", () => {
    expect(deriveWorkflowStatus({ status: "needs_reply", userState: "needs_reply" })).toBe("needs_reply")
  })
  it("unrecognized field values fall through to needs_reply", () => {
    expect(deriveWorkflowStatus({ status: "archived", userState: "custom_value", attentionCategory: "unknown", emailType: "unknown" })).toBe("needs_reply")
  })
})

describe("aiCategoryLabel", () => {
  it("returns label for attentionCategory", () => {
    expect(aiCategoryLabel("needs_action", null)).toBe("Needs Action")
  })
  it("returns label for emailType", () => {
    expect(aiCategoryLabel(null, "newsletter")).toBe("Newsletter")
  })
  it("attentionCategory takes precedence over emailType", () => {
    expect(aiCategoryLabel("review_soon", "newsletter")).toBe("Review Soon")
  })
  it("returns null when neither is recognized", () => {
    expect(aiCategoryLabel(null, null)).toBeNull()
  })
})

describe("workflow status persistence helpers", () => {
  it("draft generation sets status to needs_reply without resetting userState", () => {
    const update = conversationUpdateForDraftReady()
    expect(update).toMatchObject({ status: "needs_reply" })
    expect(update).not.toHaveProperty("userState")
    expect(update).not.toHaveProperty("userStateSource")
  })

  it("mark Done persists as a closed conversation with userState=done", () => {
    expect(conversationUpdateForWorkflowStatus("done", new Date("2026-06-25T12:00:00Z"))).toMatchObject({
      status: "closed",
      userState: "done",
      userStateSource: "user",
    })
  })

  it("mark Waiting On persists as in_progress with userState=waiting_on", () => {
    expect(conversationUpdateForWorkflowStatus("waiting_on", new Date("2026-06-25T12:00:00Z"))).toMatchObject({
      status: "in_progress",
      userState: "waiting_on",
      userStateSource: "user",
    })
  })
})
