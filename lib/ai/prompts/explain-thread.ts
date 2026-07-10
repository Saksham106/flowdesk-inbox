import { stripHtmlToText } from "@/lib/email-body"

const RISK_LEVELS = ["low", "medium", "high"] as const

export type ExplainRiskLevel = (typeof RISK_LEVELS)[number]

export type ExplainThreadResult = {
  whatHappened: string
  whatTheyWant: string
  whatYouNeedToDo: string[]
  risks: string[]
  riskLevel: ExplainRiskLevel
  suggestedNextStep: string | null
  model: string
}

export type AiCallContext = { tenantId: string; userId: string; userEmail: string }

export type ExplainThreadPromptInput = {
  aiContext?: AiCallContext
  contactName?: string | null
  conversationStatus?: string | null
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
}

export const explainThreadJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "whatHappened",
    "whatTheyWant",
    "whatYouNeedToDo",
    "risks",
    "riskLevel",
    "suggestedNextStep",
  ],
  properties: {
    whatHappened: { type: "string" },
    whatTheyWant: { type: "string" },
    whatYouNeedToDo: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    riskLevel: { type: "string", enum: RISK_LEVELS },
    suggestedNextStep: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

export function buildExplainThreadPrompt(input: ExplainThreadPromptInput): string {
  const messages = input.messages
    .slice(-25)
    .map((message) => {
      const createdAt =
        message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt
      return `${createdAt} ${message.direction.toUpperCase()}: ${truncate(stripHtmlToText(message.body, 2500), 2500)}`
    })
    .join("\n")

  return [
    "You are FlowDesk's inbox assistant. Explain this email thread to a busy user in seconds.",
    "OUTBOUND messages were sent by the user; INBOUND messages were sent by the other party.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Field guidance:",
    "- whatHappened: 1-3 plain sentences summarizing the thread so far.",
    "- whatTheyWant: 1-2 sentences on what the other party is asking for or expecting.",
    "- whatYouNeedToDo: short imperative action items for the user; empty array if nothing is needed.",
    "- risks: deadlines, money at stake, commitments the user already made, legal/medical/financial sensitivity, or relationship risk. Empty array if none.",
    "- riskLevel: high if the thread involves legal, medical, financial, refund, contract, or angry-sender content; medium if there are deadlines or money; low otherwise.",
    "- suggestedNextStep: the single best next action, or null if no action is needed.",
    "",
    "Safety rules:",
    "- Never advise admitting legal liability; flag it as a risk instead.",
    "- Do not invent facts, dates, or commitments that are not in the messages.",
    "",
    `Contact: ${input.contactName?.trim() || "Unknown"}`,
    `Conversation status: ${input.conversationStatus ?? "unknown"}`,
    "",
    "Thread (oldest first):",
    messages,
  ].join("\n")
}

export function normalizeExplainThreadOutput(rawText: string, model: string): ExplainThreadResult {
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

  const whatHappened = asTrimmedString(record.whatHappened)
  if (!whatHappened) {
    throw new Error("AI response did not include whatHappened")
  }

  return {
    whatHappened,
    whatTheyWant: asTrimmedString(record.whatTheyWant) || "Unclear from the thread.",
    whatYouNeedToDo: asStringArray(record.whatYouNeedToDo),
    risks: asStringArray(record.risks),
    riskLevel: RISK_LEVELS.includes(record.riskLevel as ExplainRiskLevel)
      ? (record.riskLevel as ExplainRiskLevel)
      : "medium",
    suggestedNextStep: asTrimmedString(record.suggestedNextStep) || null,
    model,
  }
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
