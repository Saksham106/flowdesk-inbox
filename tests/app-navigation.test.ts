import { describe, expect, it } from "vitest"

import { getInboxNavigation } from "@/lib/app-navigation"

describe("getInboxNavigation (B2C: one control room for everyone)", () => {
  it("returns the same navigation regardless of account type", () => {
    const personal = getInboxNavigation("personal")
    const business = getInboxNavigation("business")
    const missing = getInboxNavigation(null)

    expect(business).toEqual(personal)
    expect(missing).toEqual(personal)
  })

  it("surfaces Approvals for every user", () => {
    for (const accountType of ["personal", "business", null, undefined]) {
      const nav = getInboxNavigation(accountType)
      const labels = [...nav.primary, ...nav.secondary].map((i) => i.label)
      expect(labels).toContain("Approvals")
    }
  })

  it("keeps Settings reachable", () => {
    const nav = getInboxNavigation("personal")
    const hrefs = [...nav.primary, ...nav.secondary].map((i) => i.href)
    expect(hrefs).toContain("/settings")
  })

  it("does not gate any item behind a business account", () => {
    // Under B2C there is no business-only surface; the personal experience is
    // the universal baseline, so nothing appears only for "business".
    const personalHrefs = new Set(
      [...getInboxNavigation("personal").primary, ...getInboxNavigation("personal").secondary].map(
        (i) => i.href
      )
    )
    const businessHrefs = [
      ...getInboxNavigation("business").primary,
      ...getInboxNavigation("business").secondary,
    ].map((i) => i.href)

    for (const href of businessHrefs) {
      expect(personalHrefs.has(href)).toBe(true)
    }
  })
})
