import { describe, expect, it } from "vitest"

import { getInboxNavigation } from "@/lib/app-navigation"
import { automationLevelLabel, buildControlRoomStatus } from "@/lib/control-room-status"
import {
  accountModeFor,
  resolveCapabilities,
  salesCrmEnabled,
} from "@/lib/tenant-capabilities"

describe("control room navigation and status helpers", () => {
  it("surfaces Approvals, Activity, and Settings for every baseline user", () => {
    for (const caps of [undefined, {}, { salesCrm: false }]) {
      const nav = getInboxNavigation(caps)
      const labels = [...nav.primary, ...nav.secondary].map((i) => i.label)
      expect(labels).toContain("Approvals")
      expect(labels).toContain("Activity")
    }
    expect(getInboxNavigation().primary.map((i) => i.href)).toContain("/settings")
  })

  it("hides or shows the Sales & CRM cluster from the capability flag", () => {
    const off = getInboxNavigation({ salesCrm: false }).secondary.map((i) => i.href)
    expect(off).not.toContain("/leads")
    expect(off).not.toContain("/reports")
    expect(off).not.toContain("/risk-radar")

    const on = getInboxNavigation({ salesCrm: true }).secondary.map((i) => i.href)
    expect(on).toContain("/leads")
    expect(on).toContain("/reports")
    expect(on).toContain("/risk-radar")
    expect(on).toContain("/meetings")
    expect(on).toContain("/knowledge-base")
    expect(getInboxNavigation({ salesCrm: true }).primary.map((i) => i.href)).toContain("/approvals")
  })

  it("labels automation levels and builds the control-room status line", () => {
    expect(automationLevelLabel(0)).toBe("read-only")
    expect(automationLevelLabel(2)).toBe("organizes Gmail")
    expect(automationLevelLabel(3)).toBe("creates drafts")
    expect(automationLevelLabel(5)).toBe("sends approved replies")
    expect(automationLevelLabel(-4)).toBe("read-only")
    expect(automationLevelLabel(99)).toBe("sends approved replies")
    expect(buildControlRoomStatus({ level: 3, pendingReview: 0, hasGmail: true })).toBe(
      "FlowDesk is working in your Gmail · Level 3 (creates drafts)"
    )
    expect(buildControlRoomStatus({ level: 3, pendingReview: 2, hasGmail: true })).toBe(
      "FlowDesk is working in your Gmail · Level 3 (creates drafts) · 2 items waiting your review"
    )
    expect(buildControlRoomStatus({ level: 2, pendingReview: 1, hasGmail: true })).toContain(
      "1 item waiting your review"
    )
    expect(buildControlRoomStatus({ level: 2, pendingReview: 0, hasGmail: true })).not.toContain("waiting")
  })

  it("tells a brand-new (no Gmail connected) user to connect instead of falsely claiming it's already working", () => {
    // Regression: a fresh signup used to see "FlowDesk is working in your
    // Gmail" before connecting anything, with no indication of what to do.
    const status = buildControlRoomStatus({ level: 2, pendingReview: 0, hasGmail: false })
    expect(status).not.toContain("is working in your Gmail")
    expect(status.toLowerCase()).toContain("connect")
    // Pending review / automation level are meaningless before anything is
    // connected, so they should not leak into the message.
    expect(buildControlRoomStatus({ level: 5, pendingReview: 3, hasGmail: false })).toBe(status)
  })

  it("resolves Sales & CRM capabilities and bridges to legacy account modes", () => {
    expect(resolveCapabilities(null)).toEqual({ salesCrm: false })
    expect(resolveCapabilities({})).toEqual({ salesCrm: false })
    expect(resolveCapabilities({ salesCrmEnabled: false })).toEqual({ salesCrm: false })
    expect(resolveCapabilities({ salesCrmEnabled: true })).toEqual({ salesCrm: true })
    expect(resolveCapabilities({ salesCrmEnabled: null })).toEqual({ salesCrm: false })
    expect(resolveCapabilities({ salesCrmEnabled: undefined })).toEqual({ salesCrm: false })
    expect(accountModeFor({ salesCrmEnabled: true })).toBe("business")
    expect(accountModeFor({ salesCrmEnabled: false })).toBe("personal")
    expect(accountModeFor(null)).toBe("personal")
    expect(salesCrmEnabled({ salesCrmEnabled: true })).toBe(true)
    expect(salesCrmEnabled({ salesCrmEnabled: false })).toBe(false)
    expect(salesCrmEnabled(null)).toBe(false)
  })
})

