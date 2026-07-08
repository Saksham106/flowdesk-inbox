import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockAutopilotSettingFindUnique } = vi.hoisted(() => ({
  mockAutopilotSettingFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autopilotSetting: { findUnique: mockAutopilotSettingFindUnique },
  },
}))

import {
  AUTOMATION_LEVEL_DEFAULT,
  clampAutomationLevel,
  deriveAutomationLevelFromLegacySettings,
  getAutomationLevel,
  isActionAllowedAtLevel,
  type AutomationAction,
} from "@/lib/agent/automation-level"

describe("level -> action mapping", () => {
  // Full matrix from the module doc table / product-direction.md: for every
  // level, exactly which automated actions are allowed.
  const expectations: Array<[number, Record<AutomationAction, boolean>]> = [
    [0, { apply_gmail_labels: false, create_gmail_drafts: false, auto_mark_read: false, auto_archive: false, auto_send: false, auto_book_event: false }],
    [1, { apply_gmail_labels: false, create_gmail_drafts: false, auto_mark_read: false, auto_archive: false, auto_send: false, auto_book_event: false }],
    [2, { apply_gmail_labels: true, create_gmail_drafts: false, auto_mark_read: false, auto_archive: false, auto_send: false, auto_book_event: false }],
    [3, { apply_gmail_labels: true, create_gmail_drafts: true, auto_mark_read: false, auto_archive: false, auto_send: false, auto_book_event: false }],
    [4, { apply_gmail_labels: true, create_gmail_drafts: true, auto_mark_read: true, auto_archive: true, auto_send: false, auto_book_event: false }],
    [5, { apply_gmail_labels: true, create_gmail_drafts: true, auto_mark_read: true, auto_archive: true, auto_send: true, auto_book_event: true }],
  ]

  it.each(expectations)("level %i allows exactly the documented actions", (level, allowed) => {
    for (const [action, expected] of Object.entries(allowed)) {
      expect(isActionAllowedAtLevel(level, action as AutomationAction)).toBe(expected)
    }
  })

  it("auto-send is never allowed at Level 3 or below (regression guard)", () => {
    for (const level of [0, 1, 2, 3]) {
      expect(isActionAllowedAtLevel(level, "auto_send")).toBe(false)
    }
  })
})

describe("clampAutomationLevel", () => {
  it("clamps out-of-range and non-finite values into [0, 5]", () => {
    expect(clampAutomationLevel(-1)).toBe(0)
    expect(clampAutomationLevel(9)).toBe(5)
    expect(clampAutomationLevel(3.7)).toBe(3)
    expect(clampAutomationLevel(Number.NaN)).toBe(0)
  })
})

describe("legacy derivation (mirrors the migration backfill)", () => {
  it("maps autopilot-enabled tenants to Level 5 (their gates still apply)", () => {
    expect(deriveAutomationLevelFromLegacySettings({ enabled: true })).toBe(5)
  })

  it("maps non-autopilot tenants to Level 3 (labels + Gmail drafts, today's shipped behavior)", () => {
    expect(deriveAutomationLevelFromLegacySettings({ enabled: false })).toBe(3)
  })

  it("maps tenants without a settings row to Level 3, never the new-tenant default", () => {
    expect(deriveAutomationLevelFromLegacySettings(null)).toBe(3)
    // The new-tenant default is lower — derivation must never increase autonomy,
    // but it must also not strip Phase A/B behavior from legacy tenants.
    expect(AUTOMATION_LEVEL_DEFAULT).toBe(2)
  })
})

describe("getAutomationLevel", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the stored level", async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 4, enabled: false })
    expect(await getAutomationLevel("tenant-1")).toBe(4)
  })

  it("falls back to legacy Level 3 when no settings row exists", async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue(null)
    expect(await getAutomationLevel("tenant-1")).toBe(3)
  })

  it("clamps corrupt stored values", async () => {
    mockAutopilotSettingFindUnique.mockResolvedValue({ automationLevel: 42, enabled: true })
    expect(await getAutomationLevel("tenant-1")).toBe(5)
  })
})
