import { describe, it, expect } from "vitest"
import { CLEANUP_TABS } from "@/lib/cleanup-tabs"

describe("cleanup tabs", () => {
  it("defines the three tabs in order with /clean-inbox as the Bulk Archive route", () => {
    expect(CLEANUP_TABS).toEqual([
      { slug: "archive", label: "Bulk Archive", href: "/clean-inbox" },
      { slug: "unsubscribe", label: "Bulk Unsubscribe", href: "/clean-inbox/unsubscribe" },
      { slug: "analytics", label: "Analytics", href: "/clean-inbox/analytics" },
    ])
  })
})
