import { describe, expect, it } from "vitest"
import { hasBulkMailSignals } from "@/lib/agent/draft-eligibility"

describe("hasBulkMailSignals", () => {
  it("detects an unsubscribe footer in the body", () => {
    expect(
      hasBulkMailSignals({
        body: "This week's roundup...\n\nTo stop receiving these emails, unsubscribe here.",
      })
    ).toBe(true)
  })

  it("detects a List-Unsubscribe header", () => {
    expect(
      hasBulkMailSignals({
        body: "Join our project by clicking the link below.",
        rawHeaders: "List-Unsubscribe: <mailto:unsub@example.com>",
      })
    ).toBe(true)
  })

  it("returns false for an ordinary human message", () => {
    expect(
      hasBulkMailSignals({
        body: "Hey, can you send over the contract by Friday?",
      })
    ).toBe(false)
  })
})
