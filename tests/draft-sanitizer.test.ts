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
    expect(result.text).toBe(original)
    expect(result.flagged).toContain("strip_too_aggressive")
    expect(result.autoFixed).toEqual([])
  })

  it("leaves a clean draft untouched", () => {
    const result = sanitizeDraftText("Thanks for the update, I'll take a look today.")
    expect(result.text).toBe("Thanks for the update, I'll take a look today.")
    expect(result.autoFixed).toEqual([])
    expect(result.flagged).toEqual([])
  })
})
