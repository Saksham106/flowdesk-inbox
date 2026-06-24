import { describe, expect, it } from "vitest"

// Mirror the pagination logic from inbox/page.tsx so tests stay independent.
function paginateResults<T>(items: T[], limit: number): { page: T[]; hasMore: boolean } {
  return {
    hasMore: items.length > limit,
    page: items.slice(0, limit),
  }
}

describe("inbox mobile pagination", () => {
  it("returns full page when result count equals limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(50)
    expect(hasMore).toBe(false)
  })

  it("detects next page when fetched count exceeds limit", () => {
    // Prisma fetches limit+1 to probe for a next page
    const items = Array.from({ length: 51 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(50)
    expect(hasMore).toBe(true)
  })

  it("returns partial page near end of data", () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(23)
    expect(hasMore).toBe(false)
  })

  it("returns empty page for empty result set", () => {
    const { page, hasMore } = paginateResults([], 50)
    expect(page).toHaveLength(0)
    expect(hasMore).toBe(false)
  })

  it("page content does not include the probe item", () => {
    const items = [10, 20, 30, 40, 50, 99] // 6 items, limit=5 → 99 is the probe
    const { page, hasMore } = paginateResults(items, 5)
    expect(page).toEqual([10, 20, 30, 40, 50])
    expect(hasMore).toBe(true)
  })
})
