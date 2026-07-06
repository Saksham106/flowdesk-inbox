import OpenAI from "openai"

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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildClassifyPrompt(input)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_classify",
        strict: true,
        schema: classifyJsonSchema,
      },
    },
  })

  return normalizeClassifyOutput(response.output_text)
}
