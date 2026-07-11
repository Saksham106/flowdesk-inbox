import { stripHtmlToText } from "@/lib/email-body"

const EMAIL_TYPES = ["needs_reply", "notification", "newsletter", "marketing", "calendar", "fyi"] as const
const ATTENTION_CATEGORIES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
] as const

export type DraftEligibilityPromptInput = {
  subject: string
  body: string
}

export type DraftEligibilityResult = {
  needsReply: boolean
  suggestedEmailType: (typeof EMAIL_TYPES)[number]
  suggestedAttentionCategory: (typeof ATTENTION_CATEGORIES)[number]
  reason: string
}

export const draftEligibilityJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["needsReply", "suggestedEmailType", "suggestedAttentionCategory", "reason"],
  properties: {
    needsReply: { type: "boolean" },
    suggestedEmailType: { type: "string", enum: EMAIL_TYPES as unknown as string[] },
    suggestedAttentionCategory: { type: "string", enum: ATTENTION_CATEGORIES as unknown as string[] },
    reason: { type: "string" },
  },
}

export function buildDraftEligibilityPrompt(input: DraftEligibilityPromptInput): string {
  return [
    "You are deciding whether an email genuinely expects a personal reply from the recipient,",
    "or whether it is one-way mail (a newsletter, product announcement, promotional share,",
    "notification, or content the recipient would only read, not respond to).",
    "",
    "A rule-based classifier already flagged this email as possibly needing a reply, but with",
    "low confidence — your job is to catch cases where that's wrong, such as a newsletter that",
    "happens to phrase something as a rhetorical question, or a one-way link/invite share.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    `Subject: ${truncate(input.subject, 200)}`,
    "",
    "Body:",
    truncate(stripHtmlToText(input.body, 2000), 2000),
  ].join("\n")
}

export function normalizeDraftEligibilityOutput(rawText: string): DraftEligibilityResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("Draft eligibility response was not valid JSON")
  }
  if (!isRecord(parsed)) {
    throw new Error("Draft eligibility response was not an object")
  }
  if (typeof parsed.needsReply !== "boolean") {
    throw new Error("Draft eligibility response missing needsReply")
  }
  if (!EMAIL_TYPES.includes(parsed.suggestedEmailType as (typeof EMAIL_TYPES)[number])) {
    throw new Error("Draft eligibility response has an invalid suggestedEmailType")
  }
  if (
    !ATTENTION_CATEGORIES.includes(
      parsed.suggestedAttentionCategory as (typeof ATTENTION_CATEGORIES)[number]
    )
  ) {
    throw new Error("Draft eligibility response has an invalid suggestedAttentionCategory")
  }
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : ""

  return {
    needsReply: parsed.needsReply,
    suggestedEmailType: parsed.suggestedEmailType as (typeof EMAIL_TYPES)[number],
    suggestedAttentionCategory: parsed.suggestedAttentionCategory as (typeof ATTENTION_CATEGORIES)[number],
    reason: reason || "No reason provided.",
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
