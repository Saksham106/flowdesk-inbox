import { describe, expect, it } from "vitest"

import { getInboxNavigation } from "@/lib/app-navigation"

describe("getInboxNavigation (B2C: baseline + opt-in Sales & CRM)", () => {
  it("surfaces Approvals and Activity for every user by default", () => {
    for (const caps of [undefined, {}, { salesCrm: false }]) {
      const nav = getInboxNavigation(caps)
      const labels = [...nav.primary, ...nav.secondary].map((i) => i.label)
      expect(labels).toContain("Approvals")
      expect(labels).toContain("Activity")
    }
  })

  it("keeps Settings reachable", () => {
    const hrefs = getInboxNavigation().primary.map((i) => i.href)
    expect(hrefs).toContain("/settings")
  })

  it("hides the Sales & CRM cluster when the capability is off", () => {
    const hrefs = getInboxNavigation({ salesCrm: false }).secondary.map((i) => i.href)
    expect(hrefs).not.toContain("/leads")
    expect(hrefs).not.toContain("/reports")
    expect(hrefs).not.toContain("/risk-radar")
  })

  it("resurfaces the Sales & CRM cluster when the capability is on", () => {
    const hrefs = getInboxNavigation({ salesCrm: true }).secondary.map((i) => i.href)
    expect(hrefs).toContain("/leads")
    expect(hrefs).toContain("/reports")
    expect(hrefs).toContain("/risk-radar")
    expect(hrefs).toContain("/meetings")
    expect(hrefs).toContain("/knowledge-base")
    // Baseline supervision surfaces stay present too.
    expect(hrefs).toContain("/approvals")
  })
})
