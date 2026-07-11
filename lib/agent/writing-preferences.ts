export type WritingPreferences = {
  forbidEmDash: boolean
  preferredGreetings: string[]
  avoidedPhrases: string[]
  preferredSignoffs: string[]
  formality: string | null
  replyLength: string | null
  customInstruction: string | null
}

export const DEFAULT_WRITING_PREFERENCES: WritingPreferences = {
  forbidEmDash: false,
  preferredGreetings: [],
  avoidedPhrases: [],
  preferredSignoffs: [],
  formality: null,
  replyLength: null,
  customInstruction: null,
}

export function validateDraftWritingPreferences(
  text: string,
  preferences: WritingPreferences | null | undefined
): string[] {
  if (!preferences) return []

  const failures: string[] = []
  if (preferences.forbidEmDash && text.includes("—")) {
    failures.push("Draft contains an em dash, which is prohibited by your writing preferences.")
  }

  for (const phrase of preferences.avoidedPhrases) {
    if (phrase && text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) {
      failures.push(`Draft contains avoided phrase: ${phrase}`)
    }
  }

  return failures
}
