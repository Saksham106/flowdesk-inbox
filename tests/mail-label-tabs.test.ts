import { describe, expect, it } from "vitest"
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels"
import { MAIL_LABEL_TABS, buildMailLabelTabWhere, matchesMailLabelTab } from "@/lib/mail-label-tabs"

describe("MAIL_LABEL_TABS", () => {
  it("matches the canonical Gmail label vocabulary plus All", () => {
    expect(MAIL_LABEL_TABS.map((t) => t.label)).toEqual([
      "All",
      ...FLOWDESK_GMAIL_LABEL_NAMES,
    ])
  })

  it("does not include legacy synthetic tabs", () => {
    expect(MAIL_LABEL_TABS.map((t) => t.label)).not.toContain("Important")
    expect(MAIL_LABEL_TABS.map((t) => t.label)).not.toContain("Other")
  })
})

describe("matchesMailLabelTab", () => {
  it("matches workflow, draft, attention, and content state to Gmail labels", () => {
    expect(matchesMailLabelTab("needs_reply", { workflowStatus: "needs_reply", draftStatus: null, attentionCategory: null, emailType: null })).toBe(true)
    expect(matchesMailLabelTab("autodrafted", { workflowStatus: "draft_ready", draftStatus: "proposed", attentionCategory: null, emailType: null })).toBe(true)
    expect(matchesMailLabelTab("needs_action", { workflowStatus: "needs_reply", draftStatus: null, attentionCategory: "needs_action", emailType: null })).toBe(true)
    expect(matchesMailLabelTab("marketing", { workflowStatus: "done", draftStatus: null, attentionCategory: null, emailType: "marketing" })).toBe(true)
  })
})

describe("buildMailLabelTabWhere", () => {
  it("builds prefilters for content label tabs", () => {
    expect(buildMailLabelTabWhere("notification")).toEqual({
      stateRecord: { is: { emailType: { in: ["notification", "fyi"] } } },
    })
  })
})
