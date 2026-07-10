const URGENCY_LEVELS = ["low", "medium", "high"] as const
export type LeadScoringUrgency = (typeof URGENCY_LEVELS)[number]

export type LeadScoringResult = {
  score: number
  scoreExplanation: string
  estimatedValue: number | null
  need: string
  urgency: LeadScoringUrgency
  budgetClue: string | null
  model: string
}

export type AiCallContext = { tenantId: string; userId: string; userEmail: string }

export type LeadScoringPromptInput = {
  aiContext?: AiCallContext
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
  existingNeed?: string | null
  existingUrgency?: string | null
  existingBudgetClue?: string | null
}

export const leadScoringJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "scoreExplanation", "estimatedValue", "need", "urgency", "budgetClue"],
  properties: {
    score: { type: "number" },
    scoreExplanation: { type: "string" },
    estimatedValue: { anyOf: [{ type: "number" }, { type: "null" }] },
    need: { type: "string" },
    urgency: { type: "string", enum: ["low", "medium", "high"] },
    budgetClue: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

export function buildLeadScoringPrompt(input: LeadScoringPromptInput): string {
  const messages = input.messages
    .slice(-20)
    .map((m) => {
      const at = m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt
      return `${at} ${m.direction.toUpperCase()}: ${truncate(m.body, 300)}`
    })
    .join("\n")

  const contextLines = [
    input.existingNeed ? `Previously extracted need: ${input.existingNeed}` : null,
    input.existingUrgency ? `Previously extracted urgency: ${input.existingUrgency}` : null,
    input.existingBudgetClue ? `Previously extracted budget clue: ${input.existingBudgetClue}` : null,
  ].filter((line): line is string => line !== null)

  return [
    "You are FlowDesk's lead intelligence engine. Score the sales potential of this email thread.",
    "OUTBOUND messages were sent by the business owner; INBOUND messages were sent by the potential customer.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Scoring rubric:",
    "80-100: Explicit intent — demo request, 'ready to move forward', specific pricing ask with timeline, named budget.",
    "60-79:  Moderate intent — qualifying question, named use case, budget range mentioned, urgency signals.",
    "40-59:  Early interest — vague inquiry, 'just looking', no urgency, no budget signals.",
    "1-39:   Weak signal — generic question, unlikely buyer, FYI context only.",
    "",
    "Field guidance:",
    "- score: integer 1-100 based on the rubric above.",
    "- scoreExplanation: 1-2 sentences explaining what signals drove the score. Be specific.",
    "- estimatedValue: rough dollar value of the deal if it closes, or null if there are no value signals.",
    "- need: 1 sentence describing what the person is looking for.",
    "- urgency: low / medium / high based on timeline signals in the thread.",
    "- budgetClue: any budget signal as a short string, or null if none.",
    "",
    "Safety rules:",
    "- Do not invent facts not present in the thread.",
    "- Do not treat FYI emails or newsletters as leads.",
    ...(contextLines.length > 0 ? ["", ...contextLines] : []),
    "",
    "Thread (oldest first):",
    messages,
  ].join("\n")
}

export function normalizeLeadScoringOutput(rawText: string, model: string): LeadScoringResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }

  const record = parsed as Record<string, unknown>

  const rawScore = typeof record.score === "number" ? record.score : 0
  const score = Math.max(1, Math.min(100, Math.round(rawScore)))

  const scoreExplanation = asTrimmedString(record.scoreExplanation)
  if (!scoreExplanation) throw new Error("AI response did not include scoreExplanation")

  const estimatedValue =
    typeof record.estimatedValue === "number" && record.estimatedValue > 0
      ? Math.round(record.estimatedValue)
      : null

  const urgency: LeadScoringUrgency = URGENCY_LEVELS.includes(record.urgency as LeadScoringUrgency)
    ? (record.urgency as LeadScoringUrgency)
    : "medium"

  return {
    score,
    scoreExplanation,
    estimatedValue,
    need: asTrimmedString(record.need) || "Expressed interest in the product or service.",
    urgency,
    budgetClue: asTrimmedString(record.budgetClue) || null,
    model,
  }
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
