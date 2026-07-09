import { describe, it, expect } from "vitest"
import { ASSISTANT_TABS } from "@/lib/assistant-tabs"

describe("assistant tabs", () => {
  it("defines the four tabs in order", () => {
    expect(ASSISTANT_TABS.map((t) => t.slug)).toEqual([
      "rules", "test-rules", "history", "settings",
    ])
  })
  it("gives every tab a route under /assistant", () => {
    for (const t of ASSISTANT_TABS) expect(t.href).toBe(`/assistant/${t.slug}`)
  })
})
