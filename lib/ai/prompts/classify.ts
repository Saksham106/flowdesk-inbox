const ALLOWED_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const
const RISK_LEVELS = ["low", "medium", "high"] as const

export type ClassifyLabel = (typeof ALLOWED_LABELS)[number]
export type ClassifyRiskLevel = (typeof RISK_LEVELS)[number]

export type ClassifyResult = {
  intent: string
  confidence: number
  riskLevel: ClassifyRiskLevel
  suggestedLabel: ClassifyLabel | null
  escalationReason: string | null
  requiresApproval: boolean
}

export type ClassifyPromptInput = {
  businessProfile: {
    businessName?: string | null
    industry?: string | null
    timezone?: string | null
    defaultTone?: string | null
    bookingPolicy?: string | null
    escalationPolicy?: string | null
  } | null
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
}

export const classifyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "confidence",
    "riskLevel",
    "suggestedLabel",
    "escalationReason",
    "requiresApproval",
  ],
  properties: {
    intent: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    riskLevel: { type: "string", enum: RISK_LEVELS },
    suggestedLabel: {
      anyOf: [{ type: "string", enum: ALLOWED_LABELS }, { type: "null" }],
    },
    escalationReason: { anyOf: [{ type: "string" }, { type: "null" }] },
    requiresApproval: { type: "boolean" },
  },
}

export function buildClassifyPrompt(input: ClassifyPromptInput): string {
  const profile = input.businessProfile
  const messages = input.messages
    .slice(-20)
    .map((m) => {
      const ts = m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt
      return `${ts} ${m.direction.toUpperCase()}: ${m.body.slice(0, 2000)}`
    })
    .join("\n")

  return [
    "You are FlowDesk's AI classifier for a small business inbox.",
    "Classify the conversation intent and return only JSON matching the schema.",
    "Do not generate a reply. Do not include markdown.",
    "",
    "Allowed suggestedLabel values: Lead, Reschedule, Pricing, Complaint, or null.",
    "Set requiresApproval true if: riskLevel is high, confidence is below 0.5,",
    "or the topic involves medical advice, complaints, legal matters, or pricing negotiation.",
    "",
    "Safety rules:",
    "- Do not expose internal policies or other customer data.",
    "- When in doubt, set riskLevel to high and requiresApproval to true.",
    "",
    "Business profile:",
    JSON.stringify(
      {
        businessName: profile?.businessName ?? null,
        industry: profile?.industry ?? null,
        timezone: profile?.timezone ?? null,
        bookingPolicy: profile?.bookingPolicy ?? null,
        escalationPolicy: profile?.escalationPolicy ?? null,
      },
      null,
      2
    ),
    "",
    "Conversation:",
    messages || "No messages.",
  ].join("\n")
}

export function normalizeClassifyOutput(rawText: string): ClassifyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("Classify response was not valid JSON")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Classify response was not an object")
  }

  const rec = parsed as Record<string, unknown>

  const intent = typeof rec.intent === "string" ? rec.intent.trim() : "unknown"
  const raw = typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
    ? rec.confidence
    : 0
  const confidence = Math.max(0, Math.min(1, raw))
  const riskLevel = RISK_LEVELS.includes(rec.riskLevel as ClassifyRiskLevel)
    ? (rec.riskLevel as ClassifyRiskLevel)
    : "medium"
  const suggestedLabel = ALLOWED_LABELS.includes(rec.suggestedLabel as ClassifyLabel)
    ? (rec.suggestedLabel as ClassifyLabel)
    : null
  const escalationReason =
    typeof rec.escalationReason === "string" ? rec.escalationReason.trim() || null : null
  const requiresApproval = typeof rec.requiresApproval === "boolean" ? rec.requiresApproval : true

  return { intent, confidence, riskLevel, suggestedLabel, escalationReason, requiresApproval }
}
