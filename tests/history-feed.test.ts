import { describe, expect, it } from "vitest"

import {
  HISTORY_ACTIONS,
  describeAuditEvent,
  historyActionsForCategory,
} from "@/lib/history-feed"

describe("describeAuditEvent", () => {
  it("renders applied labels as a plain-English sentence with the mailbox name", () => {
    const entry = describeAuditEvent("gmail.writeback.completed", {
      result: "labels_applied",
      labels: ["Newsletter", "Read Later"],
      conversationId: "conv-1",
    })
    expect(entry).toEqual({
      category: "labeled",
      text: "Labeled a thread “Newsletter”, “Read Later” in Gmail",
      conversationId: "conv-1",
    })
  })

  it("renders an empty label set as a cleanup", () => {
    const entry = describeAuditEvent("outlook.writeback.completed", {
      result: "labels_applied",
      labels: [],
    })
    expect(entry?.text).toBe("Cleared FlowDesk labels from a thread in Outlook")
  })

  it("maps mailbox mutations to the swept bucket", () => {
    expect(describeAuditEvent("gmail.writeback.completed", { result: "marked_read" })?.category).toBe("swept")
    expect(describeAuditEvent("gmail.writeback.completed", { result: "archived" })?.category).toBe("swept")
    expect(describeAuditEvent("automation.auto_triage", { emailType: "newsletter" })?.text).toBe(
      "Swept a low-risk newsletter out of your inbox (marked read and archived)"
    )
  })

  it("drops silent bookkeeping results", () => {
    expect(describeAuditEvent("gmail.writeback.completed", { result: "skipped" })).toBeNull()
    expect(describeAuditEvent("gmail.writeback.completed", { result: "draft_current" })).toBeNull()
    expect(describeAuditEvent("gmail.labels.queued", {})).toBeNull()
  })

  it("describes sends, drafts, and failures", () => {
    expect(describeAuditEvent("autopilot.send", { intent: "scheduling" })?.text).toBe(
      "Sent an automatic reply (scheduling)"
    )
    expect(describeAuditEvent("draft.suggest", { conversationId: "c" })).toEqual({
      category: "drafted",
      text: "Drafted a reply for you to review",
      conversationId: "c",
    })
    const failed = describeAuditEvent("gmail.writeback.failed", { error: "invalid_grant" })
    expect(failed?.category).toBe("issues")
    expect(failed?.text).toContain("invalid_grant")
  })

  it("describes automation level changes with from/to", () => {
    expect(describeAuditEvent("automation_level.changed", { from: 2, to: 4 })?.text).toBe(
      "Automation level changed from 2 to 4"
    )
  })

  it("tolerates malformed payloads", () => {
    expect(describeAuditEvent("autopilot.send", null)?.category).toBe("sent")
    expect(describeAuditEvent("autopilot.send", ["not", "an", "object"])?.category).toBe("sent")
  })

  it("covers every listed action with either an entry or a deliberate payload-dependent drop", () => {
    for (const action of HISTORY_ACTIONS) {
      const entry = describeAuditEvent(action, { result: "labels_applied", labels: ["Handled"] })
      expect(entry, `${action} should describe to an entry`).not.toBeNull()
    }
  })
})

describe("historyActionsForCategory", () => {
  it("keeps writeback rows in every mailbox-shaped bucket", () => {
    for (const category of ["labeled", "swept", "drafted"] as const) {
      expect(historyActionsForCategory(category)).toContain("gmail.writeback.completed")
    }
    expect(historyActionsForCategory("sent")).not.toContain("gmail.writeback.completed")
  })

  it("buckets plain actions by their described category", () => {
    expect(historyActionsForCategory("sent")).toContain("autopilot.send")
    expect(historyActionsForCategory("issues")).toContain("gmail.writeback.failed")
    expect(historyActionsForCategory("meetings")).toContain("scheduling_session.booked")
  })
})
