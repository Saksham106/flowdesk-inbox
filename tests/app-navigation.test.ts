import { describe, it, expect } from "vitest"
import { getPrimaryNav, getInboxNavigation } from "@/lib/app-navigation"

describe("primary navigation", () => {
  it("has exactly the 5 primary destinations in order", () => {
    const nav = getPrimaryNav()
    expect(nav.map((i) => i.href)).toEqual([
      "/home", "/mail", "/approvals", "/clean-inbox", "/settings",
    ])
  })
  it("does not include deleted or demoted routes", () => {
    const hrefs = getPrimaryNav().map((i) => i.href)
    expect(hrefs).not.toContain("/digest")
    expect(hrefs).not.toContain("/search")
    expect(hrefs).not.toContain("/tasks")
    expect(hrefs).not.toContain("/chat")
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
