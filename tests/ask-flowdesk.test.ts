import { describe, it, expect } from "vitest"
import { ASK_FLOWDESK_SELECTOR, focusTrapTarget, isAskFlowDeskClick } from "@/lib/ask-flowdesk"

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

describe("focusTrapTarget", () => {
  const els = ["first", "mid", "last"]

  it("wraps to the first element when Tab is pressed on the last", () => {
    expect(focusTrapTarget(els, "last", false)).toBe("first")
  })

  it("wraps to the last element when Shift+Tab is pressed on the first", () => {
    expect(focusTrapTarget(els, "first", true)).toBe("last")
  })

  it("lets Tab fall through (null) in the middle of the list", () => {
    expect(focusTrapTarget(els, "mid", false)).toBeNull()
  })

  it("lets Shift+Tab fall through (null) in the middle of the list", () => {
    expect(focusTrapTarget(els, "mid", true)).toBeNull()
  })

  it("pulls focus to the first element on Tab when focus is outside the trap", () => {
    expect(focusTrapTarget(els, null, false)).toBe("first")
  })

  it("pulls focus to the last element on Shift+Tab when focus is outside the trap", () => {
    expect(focusTrapTarget(els, null, true)).toBe("last")
  })

  it("returns null when there are no focusable elements", () => {
    expect(focusTrapTarget([], null, false)).toBeNull()
    expect(focusTrapTarget([], null, true)).toBeNull()
  })
})
