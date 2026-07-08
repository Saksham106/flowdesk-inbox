import { describe, expect, it } from "vitest"

import { computeReadLaterPreview } from "@/app/components/ReadLaterSection"

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i + 1}` }))
}

describe("computeReadLaterPreview", () => {
  it("shows the first 3 items and counts the rest as overflow", () => {
    const result = computeReadLaterPreview(items(5), new Set())
    expect(result.preview.map((i) => i.id)).toEqual(["item-1", "item-2", "item-3"])
    expect(result.overflow).toBe(2)
  })

  it("reports zero overflow when there are 3 or fewer items", () => {
    const result = computeReadLaterPreview(items(3), new Set())
    expect(result.preview).toHaveLength(3)
    expect(result.overflow).toBe(0)
  })

  it("backfills a hidden item into the preview when a shown item is dismissed", () => {
    // Regression: dismissing a previewed item used to leave a vacant slot and
    // a stale "+N more" count until a full page refresh — the dismissed count
    // was computed from the original static prop, not the currently-visible set.
    const result = computeReadLaterPreview(items(5), new Set(["item-1"]))
    expect(result.preview.map((i) => i.id)).toEqual(["item-2", "item-3", "item-4"])
    expect(result.overflow).toBe(1)
  })

  it("keeps the overflow badge accurate as more items are dismissed", () => {
    const result = computeReadLaterPreview(items(5), new Set(["item-1", "item-2"]))
    expect(result.preview.map((i) => i.id)).toEqual(["item-3", "item-4", "item-5"])
    expect(result.overflow).toBe(0)
  })

  it("shows nothing queued once every item is dismissed", () => {
    const result = computeReadLaterPreview(items(2), new Set(["item-1", "item-2"]))
    expect(result.preview).toEqual([])
    expect(result.overflow).toBe(0)
  })
})
