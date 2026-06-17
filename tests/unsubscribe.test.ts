import { describe, it, expect } from "vitest"
import { parseUnsubscribeInfo } from "@/lib/agent/unsubscribe"

describe("parseUnsubscribeInfo", () => {
  it("extracts List-Unsubscribe header URL", () => {
    const result = parseUnsubscribeInfo(
      "<https://example.com/unsubscribe?token=abc123>",
      "Check out our newsletter. Click here to read more."
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toBe("https://example.com/unsubscribe?token=abc123")
  })

  it("extracts unsubscribe link from body when no header", () => {
    const result = parseUnsubscribeInfo(
      null,
      'To unsubscribe from these emails, <a href="https://example.com/optout">click here</a>.'
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toContain("optout")
  })

  it("returns false when no unsubscribe link present", () => {
    const result = parseUnsubscribeInfo(null, "Hey, just wanted to say hi!")
    expect(result.hasUnsubscribeLink).toBe(false)
    expect(result.unsubscribeUrl).toBeNull()
  })

  it("skips mailto: links", () => {
    const result = parseUnsubscribeInfo("<mailto:unsub@example.com>", "some body text")
    expect(result.hasUnsubscribeLink).toBe(false)
  })
})
