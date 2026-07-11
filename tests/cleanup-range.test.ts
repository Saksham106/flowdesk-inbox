import { describe, expect, it } from "vitest"

import { cleanupRangeCutoff, parseCleanupRange } from "@/lib/cleanup-range"

describe("cleanup ranges", () => {
  it.each([
    ["week", "week"],
    ["month", "month"],
    ["quarter", "quarter"],
    ["half_year", "half_year"],
    ["all", "all"],
    ["bad", "quarter"],
    [undefined, "quarter"],
  ] as const)("normalizes %s to %s", (value, expected) => {
    expect(parseCleanupRange(value)).toBe(expected)
  })

  it("computes calendar cutoffs and leaves all unbounded", () => {
    const now = new Date("2026-07-11T12:00:00Z")
    expect(cleanupRangeCutoff("week", now)?.toISOString()).toBe("2026-07-04T12:00:00.000Z")
    expect(cleanupRangeCutoff("month", now)?.toISOString()).toBe("2026-06-11T12:00:00.000Z")
    expect(cleanupRangeCutoff("quarter", now)?.toISOString()).toBe("2026-04-11T12:00:00.000Z")
    expect(cleanupRangeCutoff("half_year", now)?.toISOString()).toBe("2026-01-11T12:00:00.000Z")
    expect(cleanupRangeCutoff("all", now)).toBeNull()
  })
})
