import { describe, expect, it } from "vitest"
import { unwrapHardWrappedText } from "@/lib/agent/draft-sanitizer"

describe("unwrapHardWrappedText", () => {
  it("collapses a hard-wrapped paragraph into one line joined by spaces", () => {
    const wrapped =
      "Thanks so much for reaching out about the appointment next\n" +
      "week. I wanted to confirm that Tuesday at 2pm still works\n" +
      "for you, let me know if anything changes."
    const result = unwrapHardWrappedText(wrapped)
    expect(result).toBe(
      "Thanks so much for reaching out about the appointment next week. I wanted to confirm that Tuesday at 2pm still works for you, let me know if anything changes."
    )
  })

  it("preserves blank-line paragraph breaks", () => {
    const wrapped =
      "First paragraph line one that is long enough to look like a real wrap\n" +
      "first paragraph line two, continuing the same sentence naturally.\n" +
      "\n" +
      "Second paragraph only line."
    const result = unwrapHardWrappedText(wrapped)
    expect(result).toBe(
      "First paragraph line one that is long enough to look like a real wrap first paragraph line two, continuing the same sentence naturally.\n\nSecond paragraph only line."
    )
  })

  it("does not flatten a bullet list into prose", () => {
    const wrapped =
      "Here are the options:\n" +
      "- Tuesday at 2pm\n" +
      "- Wednesday at 10am\n" +
      "Let me know which works best."
    const result = unwrapHardWrappedText(wrapped)
    expect(result).toBe(
      "Here are the options:\n- Tuesday at 2pm\n- Wednesday at 10am\nLet me know which works best."
    )
  })

  it("does not flatten a numbered list into prose", () => {
    const wrapped = "Steps:\n1. Sign the form\n2. Return it by Friday\nThanks!"
    const result = unwrapHardWrappedText(wrapped)
    expect(result).toBe("Steps:\n1. Sign the form\n2. Return it by Friday\nThanks!")
  })

  it("leaves text with only natural paragraph-break newlines unchanged", () => {
    const original = "Hi there,\n\nThanks for the update, I'll take a look today.\n\nBest,\nJane"
    const result = unwrapHardWrappedText(original)
    expect(result).toBe(original)
  })

  it("does not join a short signoff line into the name below it", () => {
    // "Thanks,\nJohn" has no blank line before the name — a very common
    // signoff pattern. Both lines are short, so neither looks like a
    // hard-wrap continuation, and the break must be preserved.
    const original = "Sounds good, see you then.\n\nThanks,\nJohn"
    const result = unwrapHardWrappedText(original)
    expect(result).toBe(original)
  })

  it("leaves a normal short reply unchanged", () => {
    const original = "Thanks for the update, I'll take a look today."
    const result = unwrapHardWrappedText(original)
    expect(result).toBe(original)
  })
})
