import { describe, expect, it } from "vitest"

import { validateDraftWritingPreferences } from "@/lib/agent/writing-preferences"

describe("validateDraftWritingPreferences", () => {
  it("rejects an em dash when the user has prohibited em dashes", () => {
    expect(
      validateDraftWritingPreferences("Thanks for reaching out — I can help.", {
        forbidEmDash: true,
        preferredGreetings: [],
        avoidedPhrases: [],
        preferredSignoffs: [],
        formality: null,
        replyLength: null,
        customInstruction: null,
      })
    ).toContain("Draft contains an em dash, which is prohibited by your writing preferences.")
  })
})
