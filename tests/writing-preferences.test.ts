import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { validateDraftWritingPreferences } from "@/lib/agent/writing-preferences"

describe("validateDraftWritingPreferences", () => {
  it("renders editable controls for every persisted writing preference", () => {
    const panel = readFileSync("app/settings/PersonalStylePanel.tsx", "utf8")

    expect(panel).toContain("Preferred greetings")
    expect(panel).toContain("Phrases to avoid")
    expect(panel).toContain("Preferred sign-offs")
    expect(panel).toContain("Formality")
    expect(panel).toContain("Reply length")
    expect(panel).toContain('value={writingPreferences.preferredGreetings.join(", ")}')
    expect(panel).toContain('value={writingPreferences.avoidedPhrases.join(", ")}')
    expect(panel).toContain('value={writingPreferences.preferredSignoffs.join(", ")}')
    expect(panel).toContain('value={writingPreferences.formality ?? ""}')
    expect(panel).toContain('value={writingPreferences.replyLength ?? ""}')
  })

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
