import { runAiJsonFeature } from "@/lib/ai/gateway"
import { estimateTokenCount } from "@/lib/ai/usage"
import { prisma } from "@/lib/prisma"

export type CompiledRule = {
  ruleType: string
  conditionsJson: Record<string, unknown>
  actionJson: Record<string, unknown>
  confidence: number
}

// Thrown when compilation can't run (missing key, budget exhausted); routes map it to an HTTP status.
export class RuleCompileError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const ATTENTION_VALUES = ["needs_reply","needs_action","review_soon","read_later","waiting_on","fyi_done","quiet"]

// Quick regex patterns to avoid an LLM call for obvious cases
function tryRegexCompile(plainText: string): CompiledRule | null {
  const lower = plainText.toLowerCase()

  // Extract email: "from user@domain.com"
  const emailMatch = lower.match(/from\s+([\w.+-]+@[\w.-]+\.\w+)/)
  // Extract domain: "from @domain.com" or "from domain.com"
  const domainMatch = lower.match(/from\s+(?:@)?([\w-]+\.[\w.-]+)/)

  // Extract target attention
  let targetAttention: string | null = null
  if (/\bquiet\b|\bsilence\b|\bmute\b/.test(lower)) targetAttention = "quiet"
  else if (/read.?later\b/.test(lower)) targetAttention = "read_later"
  else if (/fyi|done\b/.test(lower)) targetAttention = "fyi_done"
  else if (/archive/.test(lower)) targetAttention = "quiet"

  if (!targetAttention) return null

  if (emailMatch) {
    return {
      ruleType: "attention",
      conditionsJson: { matchType: "email", matchValue: emailMatch[1] },
      actionJson: { targetAttention },
      confidence: 0.9,
    }
  }
  if (domainMatch) {
    return {
      ruleType: "attention",
      conditionsJson: { matchType: "domain", matchValue: domainMatch[1] },
      actionJson: { targetAttention },
      confidence: 0.85,
    }
  }
  return null
}

const ruleCompileJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ruleType", "conditionsJson", "actionJson", "confidence"],
  properties: {
    ruleType: { type: "string" },
    conditionsJson: { type: "object", additionalProperties: true },
    actionJson: { type: "object", additionalProperties: true },
    confidence: { type: "number" },
  },
}

export async function compileRule(tenantId: string, plainText: string): Promise<CompiledRule> {
  // Try fast regex path first
  const regexResult = tryRegexCompile(plainText)
  if (regexResult) return regexResult

  // Background/API caller has no session user in scope here — resolve the
  // tenant's earliest user as the owner for OpenRouter key + budget
  // attribution, and fail clearly if the tenant somehow has no user.
  const owner = await prisma.user.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  })
  if (!owner) {
    throw new RuleCompileError("No user found for tenant; cannot compile rule", 503)
  }

  const sanitizedText = plainText.replace(/["\n\r]/g, " ").slice(0, 500)

  const prompt = `You are a rule compiler for an email assistant. Convert the user's plain-English rule into a structured JSON object.

Supported ruleTypes: "attention"
Supported conditionsJson: { "matchType": "email"|"domain", "matchValue": "<email or domain>" }
Supported actionJson: { "targetAttention": one of ${JSON.stringify(ATTENTION_VALUES)} }
confidence: 0.0–1.0 (how certain you are about the interpretation)

User rule: "${sanitizedText}"

Respond with ONLY valid JSON matching this shape:
{ "ruleType": "attention", "conditionsJson": {...}, "actionJson": {...}, "confidence": 0.0 }`

  const validRuleTypes = ["attention"]
  const validTargetAttentions = ["needs_reply","needs_action","review_soon","read_later","waiting_on","fyi_done","quiet"]

  let parsed: Record<string, unknown>
  try {
    const { output } = await runAiJsonFeature<Record<string, unknown>>({
      tenantId,
      userId: owner.id,
      userEmail: owner.email,
      feature: "agent_rule.compile",
      messages: [{ role: "user", content: prompt }],
      schemaName: "flowdesk_rule_compile",
      schema: ruleCompileJsonSchema,
      temperature: 0,
      maxTokens: 200,
      estimatedInputTokens: estimateTokenCount(prompt),
      estimatedOutputTokens: 200,
    })
    parsed = output
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compile rule"
    const status = message.includes("spend limit reached") ? 429 : 503
    throw new RuleCompileError(message, status)
  }

  const ruleType = validRuleTypes.includes(parsed.ruleType as string) ? (parsed.ruleType as string) : "attention"
  const actionJson = parsed.actionJson as Record<string, unknown> | undefined
  const targetAttention = actionJson?.targetAttention
  const safeTargetAttention = validTargetAttentions.includes(targetAttention as string)
    ? (targetAttention as string)
    : undefined
  return {
    ruleType,
    conditionsJson: (parsed.conditionsJson as Record<string, unknown>) ?? {},
    actionJson: safeTargetAttention ? { targetAttention: safeTargetAttention } : {},
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  }
}
