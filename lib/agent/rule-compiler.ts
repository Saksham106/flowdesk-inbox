import OpenAI from "openai"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"

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

export async function compileRule(tenantId: string, plainText: string): Promise<CompiledRule> {
  // Try fast regex path first
  const regexResult = tryRegexCompile(plainText)
  if (regexResult) return regexResult

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new RuleCompileError("OPENAI_API_KEY is not configured", 503)
  }
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"

  const sanitizedText = plainText.replace(/["\n\r]/g, " ").slice(0, 500)

  const prompt = `You are a rule compiler for an email assistant. Convert the user's plain-English rule into a structured JSON object.

Supported ruleTypes: "attention"
Supported conditionsJson: { "matchType": "email"|"domain", "matchValue": "<email or domain>" }
Supported actionJson: { "targetAttention": one of ${JSON.stringify(ATTENTION_VALUES)} }
confidence: 0.0–1.0 (how certain you are about the interpretation)

User rule: "${sanitizedText}"

Respond with ONLY valid JSON matching this shape:
{ "ruleType": "attention", "conditionsJson": {...}, "actionJson": {...}, "confidence": 0.0 }`

  const estimatedInputTokens = estimateTokenCount(prompt)
  const budgetCheck = await checkAiBudgetForTokens({
    tenantId,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: 200,
  })
  if (!budgetCheck.allowed) {
    await recordAiUsageEvent({
      tenantId,
      feature: "agent_rule.compile",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    throw new RuleCompileError(budgetCheck.reason, 429)
  }

  const client = new OpenAI({ apiKey })
  let completion
  try {
    completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
    })
  } catch (err) {
    await recordAiUsageEvent({
      tenantId,
      feature: "agent_rule.compile",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    throw err
  }

  const validRuleTypes = ["attention"]
  const validTargetAttentions = ["needs_reply","needs_action","review_soon","read_later","waiting_on","fyi_done","quiet"]

  const raw = completion.choices[0]?.message?.content?.trim() ?? ""

  await recordAiUsageEvent({
    tenantId,
    feature: "agent_rule.compile",
    model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(raw),
    status: "succeeded",
  })
  try {
    const parsed = JSON.parse(raw)
    const ruleType = validRuleTypes.includes(parsed.ruleType) ? parsed.ruleType : "attention"
    const targetAttention = parsed.actionJson?.targetAttention
    const safeTargetAttention = validTargetAttentions.includes(targetAttention)
      ? targetAttention
      : undefined
    return {
      ruleType,
      conditionsJson: parsed.conditionsJson ?? {},
      actionJson: safeTargetAttention ? { targetAttention: safeTargetAttention } : {},
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    }
  } catch {
    return {
      ruleType: "attention",
      conditionsJson: {},
      actionJson: {},
      confidence: 0,
    }
  }
}
