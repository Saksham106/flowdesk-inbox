const ALLOWED_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const
const RISK_LEVELS = ["low", "medium", "high"] as const
const ATTENTION_CATEGORIES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
] as const

export type ClassifyLabel = (typeof ALLOWED_LABELS)[number]
export type ClassifyRiskLevel = (typeof RISK_LEVELS)[number]
export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number]

export type ClassifyResult = {
  intent: string
  attentionCategory: AttentionCategory
  classificationReason: string
  confidence: number
  riskLevel: ClassifyRiskLevel
  suggestedLabel: ClassifyLabel | null
  escalationReason: string | null
  requiresApproval: boolean
}

export type ClassifyPromptInput = {
  accountType?: "personal" | "business" | null
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
    "attentionCategory",
    "classificationReason",
    "confidence",
    "riskLevel",
    "suggestedLabel",
    "escalationReason",
    "requiresApproval",
  ],
  properties: {
    intent: { type: "string" },
    attentionCategory: { type: "string", enum: ATTENTION_CATEGORIES },
    classificationReason: { type: "string" },
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
  const isPersonal = input.accountType === "personal"
  const messages = input.messages
    .slice(-20)
    .map((m) => {
      const ts = m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt
      return `${ts} ${m.direction.toUpperCase()}: ${m.body.slice(0, 2000)}`
    })
    .join("\n")

  if (isPersonal) {
    return [
      "You are FlowDesk's email assistant for a personal inbox.",
      "Classify the email thread and return only JSON matching the schema.",
      "Do not generate a reply. Do not include markdown.",
      "",
      "Focus on:",
      "- Does this email genuinely need a personal reply from the user?",
      "- How urgent is it?",
      "- What task or action is required, if any?",
      "- Is this scheduling, follow-up, or purely informational?",
      "- Choose attentionCategory: needs_reply, needs_action, review_soon, read_later, waiting_on, fyi_done, or quiet.",
      "",
      "Attention category guide:",
      "- needs_reply: a human likely expects a response.",
      "- needs_action: user should do something but not necessarily reply, such as verification codes, password setup, account confirmation, or RSVP.",
      "- review_soon: important security, billing, account, delivery, or access alert.",
      "- read_later: useful newsletter/product update the user may want later.",
      "- waiting_on: the user is waiting for someone else.",
      "- fyi_done: safe informational message or completed transaction.",
      "- quiet: low-value automated/marketing/noise.",
      "",
      "Always set suggestedLabel to null — personal inboxes do not use business labels.",
      "Set requiresApproval true only for sensitive topics: medical, legal, financial conflict, or personal conflict.",
      "",
      "Safety rules:",
      "- Focus on personal communication only; ignore business development framing.",
      "- When in doubt, set riskLevel to medium.",
      "",
      "Conversation:",
      messages || "No messages.",
    ].join("\n")
  }

  const profile = input.businessProfile
  return [
    "You are FlowDesk's AI classifier for a small business inbox.",
    "Classify the conversation intent and return only JSON matching the schema.",
    "Do not generate a reply. Do not include markdown.",
    "",
    "Allowed suggestedLabel values: Lead, Reschedule, Pricing, Complaint, or null.",
    "Choose attentionCategory: needs_reply, needs_action, review_soon, read_later, waiting_on, fyi_done, or quiet.",
    "Use needs_action for verification codes, password setup/reset links, account confirmation, calendar invites/RSVP, or required account actions.",
    "Use review_soon for security alerts, GitHub token alerts, suspicious login, billing/payment failures, delivery issues, or account problems.",
    "Use read_later for useful newsletters or product updates; use quiet for low-value marketing/noise.",
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
  const attentionCategory = ATTENTION_CATEGORIES.includes(rec.attentionCategory as AttentionCategory)
    ? (rec.attentionCategory as AttentionCategory)
    : "needs_reply"
  const classificationReason =
    typeof rec.classificationReason === "string" && rec.classificationReason.trim()
      ? rec.classificationReason.trim()
      : `Classified as ${intent}.`
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

  return {
    intent,
    attentionCategory,
    classificationReason,
    confidence,
    riskLevel,
    suggestedLabel,
    escalationReason,
    requiresApproval,
  }
}
