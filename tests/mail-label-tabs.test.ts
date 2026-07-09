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

  // deriveWorkflowStatus (lib/workflow-status.ts) resolves workflowStatus
  // "done" via userState/status OR, independently, via a "quiet"/"fyi_done"
  // attentionCategory or a notification/newsletter/marketing emailType with
  // no status/userState involved. Every one of those paths must appear here
  // as an OR branch, or matching rows are excluded before matchesMailLabelTab
  // ever runs against them (the Prisma prefilter narrows results *before*
  // the client-side predicate is applied — see app/mail/page.tsx).
  it("includes the FYI attention/content-type branches for handled, not just userState/status", () => {
    expect(buildMailLabelTabWhere("handled")).toEqual({
      OR: [
        { userState: "done" },
        { status: "closed" },
        { stateRecord: { is: { attentionCategory: { in: ["quiet", "fyi_done"] } } } },
        { stateRecord: { is: { emailType: { in: ["notification", "newsletter", "marketing"] } } } },
      ],
    })
  })

  it("matches metadataJson-fallback attentionCategory for needs_action, not just the stateRecord column", () => {
    expect(buildMailLabelTabWhere("needs_action")).toEqual({
      OR: [
        { stateRecord: { is: { attentionCategory: "needs_action" } } },
        {
          stateRecord: {
            is: { metadataJson: { path: ["attentionCategory"], equals: "needs_action" } },
          },
        },
      ],
    })
  })

  it("covers every workflowStatus-driven path into waiting_on: userState, status, and attentionCategory", () => {
    expect(buildMailLabelTabWhere("waiting_on")).toEqual({
      OR: [
        { userState: "waiting_on" },
        { status: "in_progress" },
        { stateRecord: { is: { attentionCategory: "waiting_on" } } },
      ],
    })
  })

  it("covers every workflowStatus-driven path into read_later: userState and attentionCategory", () => {
    expect(buildMailLabelTabWhere("read_later")).toEqual({
      OR: [
        { userState: "read_later" },
        { stateRecord: { is: { attentionCategory: "read_later" } } },
      ],
    })
  })

  it("covers both paths into needs_reply: default status and draft_ready", () => {
    expect(buildMailLabelTabWhere("needs_reply")).toEqual({
      OR: [
        { status: "needs_reply" },
        { draft: { is: { status: "proposed" } } },
      ],
    })
  })

  it("covers both draftStatus values that satisfy autodrafted: proposed and approved", () => {
    expect(buildMailLabelTabWhere("autodrafted")).toEqual({
      OR: [
        { draft: { is: { status: "proposed" } } },
        { draft: { is: { status: "approved" } } },
      ],
    })
  })
})
