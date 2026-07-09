import { describe, it, expect } from "vitest"
import { MAIL_TOP_TABS, matchesMailTopTab } from "@/lib/mail-top-tabs"

describe("MAIL_TOP_TABS", () => {
  it("defines the six tabs in order", () => {
    expect(MAIL_TOP_TABS.map((t) => t.value)).toEqual([
      "important", "needs_reply", "waiting_on", "read_later", "other", "calendar",
    ])
  })
})

describe("matchesMailTopTab", () => {
  it("includes draft_ready under needs_reply", () => {
    expect(matchesMailTopTab("needs_reply", { workflowStatus: "draft_ready", emailType: null, isVip: false })).toBe(true)
  })

  it("matches needs_reply workflow status under needs_reply", () => {
    expect(matchesMailTopTab("needs_reply", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(true)
  })

  it("matches waiting_on and read_later by workflow status", () => {
    expect(matchesMailTopTab("waiting_on", { workflowStatus: "waiting_on", emailType: null, isVip: false })).toBe(true)
    expect(matchesMailTopTab("read_later", { workflowStatus: "read_later", emailType: null, isVip: false })).toBe(true)
  })

  it("matches calendar by emailType regardless of workflow status", () => {
    expect(matchesMailTopTab("calendar", { workflowStatus: "done", emailType: "calendar", isVip: false })).toBe(true)
  })

  it("matches important for VIP senders regardless of workflow status", () => {
    expect(matchesMailTopTab("important", { workflowStatus: "done", emailType: null, isVip: true })).toBe(true)
    expect(matchesMailTopTab("important", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(false)
  })

  it("matches other for done, non-calendar, non-VIP items", () => {
    expect(matchesMailTopTab("other", { workflowStatus: "done", emailType: "newsletter", isVip: false })).toBe(true)
    expect(matchesMailTopTab("other", { workflowStatus: "needs_reply", emailType: null, isVip: false })).toBe(false)
  })
})
