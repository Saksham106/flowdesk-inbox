import { describe, it, expect } from "vitest"
import { getPrimaryNav, getInboxNavigation } from "@/lib/app-navigation"

describe("primary navigation", () => {
  it("has exactly the 5 primary destinations in order", () => {
    const nav = getPrimaryNav()
    expect(nav.map((i) => i.href)).toEqual([
      "/mail",
      "/assistant",
      "/approvals",
      "/clean-inbox",
      "/settings",
    ])
  })

  it("does not include deleted or demoted routes", () => {
    const hrefs = getPrimaryNav().map((i) => i.href)
    expect(hrefs).not.toContain("/digest")
    expect(hrefs).not.toContain("/search")
    expect(hrefs).not.toContain("/tasks")
    expect(hrefs).not.toContain("/chat")
    // Tools is a placeholder page — demoted to the secondary nav until it works.
    expect(hrefs).not.toContain("/tools")
  })

  it("keeps Tools reachable from the secondary nav", () => {
    const nav = getInboxNavigation({ salesCrm: false })
    expect(nav.secondary.map((i) => i.href)).toContain("/tools")
  })

  it("does not duplicate Home — the F logo is the sole Home affordance", () => {
    const nav = getPrimaryNav()
    expect(nav.map((i) => i.href)).not.toContain("/home")
  })
})

describe("getInboxNavigation (mobile header)", () => {
  it("omits the Sales cluster for personal accounts", () => {
    const nav = getInboxNavigation({ salesCrm: false })
    const all = [...nav.primary, ...nav.secondary].map((i) => i.href)
    expect(all).not.toContain("/leads")
    expect(all).not.toContain("/reports")
  })
})
