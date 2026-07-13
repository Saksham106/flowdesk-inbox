import { describe, expect, it } from "vitest"

import { computeCleanupTrend, type CleanupAnalytics } from "@/lib/cleanup-candidates"

function analytics(overrides: Partial<CleanupAnalytics> = {}): CleanupAnalytics {
  return {
    totalCandidates: 0,
    totalCleanable: 0,
    protectedOrSkipped: 0,
    senderCount: 0,
    unsubscribableCount: 0,
    noUnsubscribeLinkCount: 0,
    byEmailType: [],
    topDomains: [],
    ...overrides,
  }
}

describe("computeCleanupTrend", () => {
  it("reports a green 'down' trend when cleanable count decreased (improvement)", () => {
    const trend = computeCleanupTrend(
      analytics({ totalCleanable: 40 }),
      analytics({ totalCleanable: 50 })
    )

    expect(trend.direction).toBe("down")
    expect(trend.deltaAbs).toBe(-10)
    expect(trend.deltaPct).toBe(-20)
  })

  it("reports a red 'up' trend when cleanable count increased (regression)", () => {
    const trend = computeCleanupTrend(
      analytics({ totalCleanable: 60 }),
      analytics({ totalCleanable: 50 })
    )

    expect(trend.direction).toBe("up")
    expect(trend.deltaAbs).toBe(10)
    expect(trend.deltaPct).toBe(20)
  })

  it("reports 'flat' when the change is negligible", () => {
    const trend = computeCleanupTrend(
      analytics({ totalCleanable: 100 }),
      analytics({ totalCleanable: 100 })
    )

    expect(trend.direction).toBe("flat")
    expect(trend.deltaAbs).toBe(0)
    expect(trend.deltaPct).toBe(0)
  })

  it("reports 'flat' with a null percentage when there is no prior-period data", () => {
    const trend = computeCleanupTrend(analytics({ totalCleanable: 30 }), null)

    expect(trend.direction).toBe("flat")
    expect(trend.deltaPct).toBeNull()
  })

  it("never divides by zero when the prior period had zero cleanable conversations", () => {
    const increased = computeCleanupTrend(
      analytics({ totalCleanable: 12 }),
      analytics({ totalCleanable: 0 })
    )
    expect(increased.direction).toBe("up")
    expect(increased.deltaPct).toBeNull()
    expect(increased.deltaAbs).toBe(12)
    expect(Number.isFinite(increased.deltaAbs)).toBe(true)

    const bothZero = computeCleanupTrend(
      analytics({ totalCleanable: 0 }),
      analytics({ totalCleanable: 0 })
    )
    expect(bothZero.direction).toBe("flat")
    expect(bothZero.deltaPct).toBeNull()
  })
})
