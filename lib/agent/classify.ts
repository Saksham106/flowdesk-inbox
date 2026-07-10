import { runAiJsonFeature } from "@/lib/ai/gateway"
import { estimateTokenCount } from "@/lib/ai/usage"

import {
  buildClassifyPrompt,
  classifyJsonSchema,
  normalizeClassifyOutput,
  type ClassifyPromptInput,
  type ClassifyResult,
} from "@/lib/ai/prompts/classify"
import { evaluateStaticRules, type StaticRuleMatch } from "@/lib/agent/static-rules"

export type { ClassifyPromptInput, ClassifyResult }
export type { StaticRuleMatch }

export type StaticClassification = {
  result: ClassifyResult
  rule: StaticRuleMatch
}

/**
 * Static-first gate ("Static first, AI second"): deterministic
 * sender/domain/subject/body rules run before any LLM classification.
 * Returns a fully-formed ClassifyResult when an active rule matches, so the
 * caller can skip the model call and its budget spend entirely. Returns null
 * when no rule matches (or the sender is unknown) — callers then fall through
 * to the existing budget-gated LLM path.
 */
export async function tryStaticClassification(input: {
  tenantId: string
  fromEmail: string | null | undefined
  subject: string
  body: string
}): Promise<StaticClassification | null> {
  if (!input.fromEmail) return null
  const rule = await evaluateStaticRules({
    tenantId: input.tenantId,
    fromEmail: input.fromEmail,
    subject: input.subject,
    body: input.body,
  })
  if (!rule) return null
  return {
    rule,
    result: {
      intent: "static_rule_match",
      attentionCategory: rule.targetAttention,
      classificationReason: `Matched your rule: ${rule.evidence.join(" and ")}.`,
      confidence: 1,
      riskLevel: "low",
      suggestedLabel: null,
      escalationReason: null,
      requiresApproval: false,
    },
  }
}

export async function classifyConversation(
  input: ClassifyPromptInput
): Promise<ClassifyResult> {
  if (!input.aiContext) {
    throw new Error(
      "AI provider is not configured: classifyConversation requires tenant/user context (aiContext) to route through OpenRouter"
    )
  }
  const { tenantId, userId, userEmail } = input.aiContext
  const prompt = buildClassifyPrompt(input)

  const { output } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId,
    userId,
    userEmail,
    feature: "agent.classify",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_classify",
    schema: classifyJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 800,
  })

  return normalizeClassifyOutput(JSON.stringify(output))
}
