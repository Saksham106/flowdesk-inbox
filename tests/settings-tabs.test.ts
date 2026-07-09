import { describe, it, expect } from "vitest"
import { SETTINGS_TABS } from "@/lib/settings-tabs"

describe("settings tabs", () => {
  it("defines the six personal-account tabs in order", () => {
    expect(SETTINGS_TABS.map((t) => t.slug)).toEqual(["connect", "gmail", "automation", "training", "profile", "data"])
  })

  it("gives every tab a route under /settings", () => {
    for (const t of SETTINGS_TABS) expect(t.href).toBe(`/settings/${t.slug}`)
  })
})
