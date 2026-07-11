import { describe, expect, it } from "vitest"
import { sanitizeDraftText } from "@/lib/agent/draft-sanitizer"

describe("sanitizeDraftText", () => {
  it("strips quoted-thread bleed", () => {
    const result = sanitizeDraftText(
      "Sure, Tuesday at 2pm works for me.\n\nOn Mon, Jan 5, 2026 at 3:00 PM Jane Doe wrote:\n> Can we meet Tuesday?"
    )
    expect(result.text).toBe("Sure, Tuesday at 2pm works for me.")
    expect(result.autoFixed).toContain("quoted_thread")
    expect(result.flagged).toEqual([])
  })

  it("strips a leading AI-preamble opener", () => {
    const result = sanitizeDraftText("Here's a draft reply:\n\nThanks for reaching out, happy to help.")
    expect(result.text).toBe("Thanks for reaching out, happy to help.")
    expect(result.autoFixed).toContain("ai_preamble")
  })

  it("flags unresolved template placeholders without stripping them", () => {
    const result = sanitizeDraftText("Hi [Client Name], thanks for your note.")
    expect(result.text).toBe("Hi [Client Name], thanks for your note.")
    expect(result.flagged).toContain("unresolved_placeholder")
  })

  it("flags raw HTML/markdown artifacts", () => {
    const result = sanitizeDraftText("Sure thing <div>here you go</div> **bold**")
    expect(result.flagged).toContain("markup_artifact")
  })

  it("flags empty text after stripping", () => {
    const result = sanitizeDraftText("On Mon, Jan 5, 2026 at 3:00 PM Jane Doe wrote:\n> Can we meet Tuesday?")
    expect(result.flagged).toContain("empty_after_strip")
  })

  it("aborts stripping and flags instead when it would remove more than 40% of the text", () => {
    const original = "Short reply.\n\nOn Mon wrote:\n" + "> quoted line\n".repeat(20)
    const result = sanitizeDraftText(original)
    // When aborting, returns trimmed original (not raw original with trailing whitespace)
    expect(result.text).toBe(original.trim())
    expect(result.flagged).toContain("strip_too_aggressive")
    expect(result.autoFixed).toEqual([])
  })

  it("leaves a clean draft untouched", () => {
    const result = sanitizeDraftText("Thanks for the update, I'll take a look today.")
    expect(result.text).toBe("Thanks for the update, I'll take a look today.")
    expect(result.autoFixed).toEqual([])
    expect(result.flagged).toEqual([])
  })

  it("does not flag strip_too_aggressive when high fraction of original was quoted but result is reasonable length", () => {
    // A coherent reply to a very long quoted thread: stripping >40% of total text
    // is normal and expected, NOT a sign of over-aggressive stripping.
    // This documents the intentional contract: fraction alone doesn't trigger the abort—
    // only when BOTH high fraction AND short result occur together.
    const original = "Agreed, sounds good to me!\n\nOn Mon, Jan 5, 2026 at 3:00 PM Jane Doe wrote:\n" + "> quoted line\n".repeat(15)
    const result = sanitizeDraftText(original)
    expect(result.text).toBe("Agreed, sounds good to me!")
    expect(result.autoFixed).toContain("quoted_thread")
    // High fraction stripped (>40%), but remaining length is good (26 chars), so
    // strip_too_aggressive should NOT be flagged (the gating prevents it).
    expect(result.flagged).not.toContain("strip_too_aggressive")
  })

  it("flags both strip_too_aggressive and empty_after_strip when both conditions are true", () => {
    // Construct a case where: (1) >40% of original is stripped, AND (2) result is <12 chars.
    // Both conditions must be true to trigger abort, and when they are, both flags appear.
    const original = "Hi.\n\nOn Mon wrote:\n" + "> quoted line here\n".repeat(15)
    const result = sanitizeDraftText(original)
    // After stripping the "On Mon wrote:" header and quoted lines, we're left with "Hi." (3 chars).
    // This is <12 chars (MIN_VIABLE_LENGTH) AND represents >40% of original stripped.
    // Both conditions true → abort → both flags present.
    expect(result.flagged).toContain("empty_after_strip")
    expect(result.flagged).toContain("strip_too_aggressive")
    // When aborting, autoFixed is cleared
    expect(result.autoFixed).toEqual([])
  })
})
