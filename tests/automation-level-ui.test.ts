import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  join(process.cwd(), "app/settings/AutopilotSettingsForm.tsx"),
  "utf8"
)

describe("AutopilotSettingsForm trust ladder UI", () => {
  it("renders all six automation levels with plain-language descriptions", () => {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      expect(source).toContain(`level: ${level}`)
    }
    expect(source).toContain("Observe only")
    expect(source).toContain("Suggest in dashboard")
    expect(source).toContain("Organize Gmail")
    expect(source).toContain("Draft in Gmail")
    expect(source).toContain("Light autopilot")
    expect(source).toContain("Auto-send (restricted)")
  })

  it("marks the current level and requires an explicit confirm to change", () => {
    expect(source).toContain("Current")
    expect(source).toContain("pendingLevel")
    expect(source).toContain("handleConfirmLevel")
    expect(source).toContain("Confirm Level")
    expect(source).toContain("Cancel")
  })

  it("keeps the granular settings as an advanced section under the level control", () => {
    expect(source).toContain("Advanced auto-send settings")
    expect(source).toContain("Enable autopilot")
    expect(source).toContain("Max auto-sends per day")
  })

  it("sends only automationLevel when confirming a level change", () => {
    expect(source).toContain("JSON.stringify({ automationLevel: pendingLevel })")
  })
})
