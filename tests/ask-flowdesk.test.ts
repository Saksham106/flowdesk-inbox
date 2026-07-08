import { describe, it, expect } from "vitest"
import { ASK_FLOWDESK_SELECTOR, isAskFlowDeskClick } from "@/lib/ask-flowdesk"

function fakeTarget(matches: boolean) {
  return { closest: (selector: string) => (matches && selector === ASK_FLOWDESK_SELECTOR ? {} : null) }
}

describe("isAskFlowDeskClick", () => {
  it("is true when the click target is inside an Ask FlowDesk trigger", () => {
    expect(isAskFlowDeskClick(fakeTarget(true))).toBe(true)
  })

  it("is false when the click target is elsewhere on the page", () => {
    expect(isAskFlowDeskClick(fakeTarget(false))).toBe(false)
  })

  it("is false for a null target", () => {
    expect(isAskFlowDeskClick(null)).toBe(false)
  })
})
