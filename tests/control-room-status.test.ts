import { describe, expect, it } from "vitest"

import { automationLevelLabel, buildControlRoomStatus } from "@/lib/control-room-status"

describe("automationLevelLabel", () => {
  it("labels each level in plain English", () => {
    expect(automationLevelLabel(0)).toBe("read-only")
    expect(automationLevelLabel(2)).toBe("organizes Gmail")
    expect(automationLevelLabel(3)).toBe("creates drafts")
    expect(automationLevelLabel(5)).toBe("sends approved replies")
  })

  it("clamps out-of-range levels", () => {
    expect(automationLevelLabel(-4)).toBe("read-only")
    expect(automationLevelLabel(99)).toBe("sends approved replies")
  })
})

describe("buildControlRoomStatus", () => {
  it("states the level and its meaning", () => {
    expect(buildControlRoomStatus({ level: 3, pendingReview: 0 })).toBe(
      "FlowDesk is working in your Gmail · Level 3 (creates drafts)"
    )
  })

  it("appends the pending-review count when there is something to review", () => {
    expect(buildControlRoomStatus({ level: 3, pendingReview: 2 })).toBe(
      "FlowDesk is working in your Gmail · Level 3 (creates drafts) · 2 items waiting your review"
    )
  })

  it("uses the singular noun for a single pending item", () => {
    expect(buildControlRoomStatus({ level: 2, pendingReview: 1 })).toContain(
      "1 item waiting your review"
    )
  })

  it("omits the count entirely when nothing is waiting", () => {
    expect(buildControlRoomStatus({ level: 2, pendingReview: 0 })).not.toContain("waiting")
  })
})
