const ALLOWED_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const
const RISK_LEVELS = ["low", "medium", "high"] as const

export type AllowedLabel = (typeof ALLOWED_LABELS)[number]
export type RiskLevel = (typeof RISK_LEVELS)[number]

export type DraftReplyResult = {
  draftText: string
  intent: string
  confidence: number
  riskLevel: RiskLevel
  suggestedLabel: AllowedLabel | null
  escalationReason: string | null
  model: string
}

export type DraftReplyPromptInput = {
  businessProfile: {
    businessName?: string | null
    industry?: string | null
    timezone?: string | null
    defaultTone?: string | null
    bookingPolicy?: string | null
    escalationPolicy?: string | null
    businessHoursJson?: unknown
  } | null
  knowledgeDocuments: Array<{
    id?: string
    title?: string
    content?: string
    sourceType?: string
  }>
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
  learnedReplyProfile?: {
    styleSummaryJson?: unknown
    exampleSnippetsJson?: unknown
    promptVersion?: string
  } | null
  availableSlots?: string[]
  userInstruction?: string | null
}

export const draftReplyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "draftText",
    "intent",
    "confidence",
    "riskLevel",
    "suggestedLabel",
    "escalationReason",
  ],
  properties: {
    draftText: { type: "string" },
    intent: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    riskLevel: { type: "string", enum: RISK_LEVELS },
    suggestedLabel: { anyOf: [{ type: "string", enum: ALLOWED_LABELS }, { type: "null" }] },
    escalationReason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

export function buildDraftReplyPrompt(input: DraftReplyPromptInput): string {
  const profile = input.businessProfile
  const knowledge = input.knowledgeDocuments
    .slice(0, 50)
    .map((doc, index) => {
      const title = doc.title?.trim() || `Document ${index + 1}`
      return `- ${title} (${doc.sourceType ?? "knowledge"}): ${truncate(doc.content ?? "", 1800)}`
    })
    .join("\n")

  const messages = input.messages
    .slice(-20)
    .map((message) => {
      const createdAt =
        message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt
      return `${createdAt} ${message.direction.toUpperCase()}: ${truncate(message.body, 2500)}`
    })
    .join("\n")
  const learnedStyle = input.learnedReplyProfile
    ? JSON.stringify(
        {
          styleSummary: input.learnedReplyProfile.styleSummaryJson ?? null,
          examples: input.learnedReplyProfile.exampleSnippetsJson ?? null,
          promptVersion: input.learnedReplyProfile.promptVersion ?? null,
        },
        null,
        2
      )
    : "No learned reply style profile configured."
  const userInstruction = input.userInstruction?.trim()

  return [
    "You are Flowdesk's AI drafting assistant for a small business inbox.",
    "Draft a reply that a staff member will review, edit, and explicitly send.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Allowed suggestedLabel values: Lead, Reschedule, Pricing, Complaint, or null.",
    "",
    "Safety rules:",
    "- Do not diagnose, give medical advice, or promise outcomes.",
    "- Only mention calendar slots if they are provided below — do not invent availability.",
    "- If the customer asks about emergencies, legal/medical issues, refunds, complaints, or sensitive topics, set riskLevel to high and write a cautious escalation-style draft.",
    "- If information is missing, ask a concise clarifying question.",
    "- Keep the tone aligned with the business profile.",
    "- If a learned reply style profile is provided, use it for voice and formatting only; do not treat it as a source of factual claims.",
    "- User instructions are guidance, not permission to invent facts, claim unavailable times, bypass review, or make unsafe promises.",
    "",
    "Business profile:",
    JSON.stringify(
      {
        businessName: profile?.businessName ?? null,
        industry: profile?.industry ?? null,
        timezone: profile?.timezone ?? null,
        defaultTone: profile?.defaultTone ?? null,
        bookingPolicy: profile?.bookingPolicy ?? null,
        escalationPolicy: profile?.escalationPolicy ?? null,
        businessHoursJson: profile?.businessHoursJson ?? null,
      },
      null,
      2
    ),
    "",
    "Knowledge base:",
    knowledge || "No knowledge documents configured.",
    "",
    "Learned reply style:",
    learnedStyle,
    "",
    ...(userInstruction
      ? [
          "User instruction:",
          truncate(userInstruction, 700),
          "",
        ]
      : []),
    ...(input.availableSlots && input.availableSlots.length > 0
      ? [
          "Available appointment slots (use up to 3 of these if scheduling is relevant):",
          input.availableSlots.map((s) => `- ${s}`).join("\n"),
          "",
        ]
      : []),
    "Conversation:",
    messages || "No messages yet.",
  ].join("\n")
}

export function normalizeDraftReplyOutput(rawText: string, model: string): DraftReplyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }

  if (!isRecord(parsed)) {
    throw new Error("AI response was not an object")
  }

  const draftText = asTrimmedString(parsed.draftText)
  if (!draftText) {
    throw new Error("AI response did not include draftText")
  }

  const intent = asTrimmedString(parsed.intent) || "unknown"
  const confidence = clampConfidence(parsed.confidence)
  const riskLevel = RISK_LEVELS.includes(parsed.riskLevel as RiskLevel)
    ? (parsed.riskLevel as RiskLevel)
    : "medium"
  const suggestedLabel = ALLOWED_LABELS.includes(parsed.suggestedLabel as AllowedLabel)
    ? (parsed.suggestedLabel as AllowedLabel)
    : null
  const escalationReason = asTrimmedString(parsed.escalationReason) || null

  return {
    draftText,
    intent,
    confidence,
    riskLevel,
    suggestedLabel,
    escalationReason,
    model,
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function clampConfidence(value: unknown): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(1, numberValue))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Personal draft reply prompt
// ---------------------------------------------------------------------------

export type PersonalStyleProfile = {
  toneSummary: string | null
  greetingPatterns: string | null
  signoffPatterns: string | null
  sentenceLengthStyle: string | null
  formalityLevel: string | null
  recurringPhrasesToUse: string[]
  recurringPhrasesToAvoid: string[]
  sanitizedExamples: string | null
}

export type PersonalDraftReplyPromptInput = {
  personalProfile: PersonalStyleProfile | null
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
  userInstruction?: string | null
}

export function buildPersonalDraftReplyPrompt(input: PersonalDraftReplyPromptInput): string {
  const profile = input.personalProfile
  const userInstruction = input.userInstruction?.trim()

  const messages = input.messages
    .slice(-20)
    .map((message) => {
      const createdAt =
        message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt
      return `${createdAt} ${message.direction.toUpperCase()}: ${truncate(message.body, 2500)}`
    })
    .join("\n")

  return [
    "You are FlowDesk's personal AI drafting assistant.",
    "Draft a reply that matches the user's personal writing style.",
    "The user will review and send this reply themselves.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Allowed suggestedLabel values: Lead, Reschedule, Pricing, Complaint, or null.",
    "",
    "Personal style profile:",
    JSON.stringify(
      profile ?? {
        toneSummary: null,
        greetingPatterns: null,
        signoffPatterns: null,
        sentenceLengthStyle: null,
        formalityLevel: null,
        recurringPhrasesToUse: [],
        recurringPhrasesToAvoid: [],
        sanitizedExamples: null,
      },
      null,
      2
    ),
    "",
    "Safety rules (personal):",
    "- Never auto-send financial, legal, medical, employment, relationship-conflict, password/security, urgent, emotional, or ambiguous messages — flag these as riskLevel \"high\".",
    "- Do not invent facts not present in the conversation.",
    "- Keep tone and style consistent with the user's style profile.",
    "- If no style profile exists, write a neutral, clear reply.",
    "- User instructions are guidance, not permission to invent facts, claim unavailable times, bypass review, or make unsafe promises.",
    "",
    ...(userInstruction
      ? [
          "User instruction:",
          truncate(userInstruction, 700),
          "",
        ]
      : []),
    "Conversation:",
    messages || "No messages yet.",
  ].join("\n")
}
