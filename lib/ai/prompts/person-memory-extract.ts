export type PersonMemoryExtractInput = {
  contactName: string
  messages: Array<{ direction: "inbound" | "outbound"; body: string; createdAt: Date }>
}

export type PersonMemoryExtractResult = {
  summary: string
  preferences: string | null
  openQuestions: string | null
  promisedActions: string | null
}

export function buildPersonMemoryExtractPrompt(input: PersonMemoryExtractInput): string {
  const recent = input.messages.slice(-30)
  const formatted = recent
    .map((m) => `[${m.direction === "inbound" ? input.contactName : "You"}] ${m.body.slice(0, 200)}`)
    .join("\n")

  return `You are analyzing email conversations with ${input.contactName} to build a relationship memory card.

CONVERSATION HISTORY (recent messages):
${formatted}

Extract the following about ${input.contactName}. Return ONLY valid JSON with these keys:
- summary: A 2-3 sentence factual summary of who this person is and what they have communicated about.
- preferences: A short note on how they like to communicate (tone, length, timing), or null if unclear.
- openQuestions: Questions they asked that haven't been answered yet, or null if none.
- promisedActions: Things you (the email owner) have promised or committed to for them, or null if none.

Strict rules:
- No invented facts. Only infer from the messages shown.
- Keep each field under 200 characters.
- Return null for fields with no evidence.

JSON:`
}

export const personMemoryExtractJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "preferences", "openQuestions", "promisedActions"],
  properties: {
    summary: { type: "string" },
    preferences: { anyOf: [{ type: "string" }, { type: "null" }] },
    openQuestions: { anyOf: [{ type: "string" }, { type: "null" }] },
    promisedActions: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

export function normalizePersonMemoryExtractResult(raw: unknown): PersonMemoryExtractResult | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.summary !== "string") return null
  return {
    summary: r.summary.slice(0, 500),
    preferences: typeof r.preferences === "string" ? r.preferences.slice(0, 300) : null,
    openQuestions: typeof r.openQuestions === "string" ? r.openQuestions.slice(0, 300) : null,
    promisedActions: typeof r.promisedActions === "string" ? r.promisedActions.slice(0, 300) : null,
  }
}
