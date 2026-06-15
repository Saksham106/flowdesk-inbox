import { describe, it, expect } from "vitest"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"

describe("detectSensitiveMatches", () => {
  it("detects legal language", () => {
    const result = detectSensitiveMatches("Please review the subpoena and consult your attorney.")
    expect(result.some((m) => m.category === "legal")).toBe(true)
    expect(result.some((m) => m.phrase.toLowerCase().includes("subpoena"))).toBe(true)
  })

  it("detects immigration language", () => {
    const result = detectSensitiveMatches("My green card application is at USCIS.")
    expect(result.some((m) => m.category === "immigration")).toBe(true)
  })

  it("detects tax language", () => {
    const result = detectSensitiveMatches("The IRS sent a tax audit notice.")
    expect(result.some((m) => m.category === "tax")).toBe(true)
  })

  it("detects medical language", () => {
    const result = detectSensitiveMatches("The diagnosis came back from the doctor.")
    expect(result.some((m) => m.category === "medical")).toBe(true)
  })

  it("detects HR language", () => {
    const result = detectSensitiveMatches("HR sent a termination notice about my employment.")
    expect(result.some((m) => m.category === "hr")).toBe(true)
  })

  it("detects emotional language", () => {
    const result = detectSensitiveMatches("We are going through a divorce and need help with custody.")
    expect(result.some((m) => m.category === "emotional")).toBe(true)
  })

  it("detects financial/dispute language", () => {
    const result = detectSensitiveMatches("This invoice is past due and we may go to collections.")
    expect(result.some((m) => m.category === "financial")).toBe(true)
  })

  it("returns empty array for non-sensitive text", () => {
    const result = detectSensitiveMatches("Thanks for scheduling the meeting for Tuesday!")
    expect(result).toHaveLength(0)
  })

  it("deduplicates identical phrases", () => {
    const result = detectSensitiveMatches("lawsuit lawsuit lawsuit")
    const phrases = result.map((m) => m.phrase)
    expect(new Set(phrases).size).toBe(phrases.length)
  })
})
