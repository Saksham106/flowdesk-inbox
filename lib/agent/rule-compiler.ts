import { openai } from "@/lib/ai/openai-provider"

export type CompiledRule = {
  ruleType: string
  conditionsJson: Record<string, unknown>
  actionJson: Record<string, unknown>
  confidence: number
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

export async function compileRule(plainText: string): Promise<CompiledRule> {
  // Try fast regex path first
  const regexResult = tryRegexCompile(plainText)
  if (regexResult) return regexResult

  const prompt = `You are a rule compiler for an email assistant. Convert the user's plain-English rule into a structured JSON object.

Supported ruleTypes: "attention"
Supported conditionsJson: { "matchType": "email"|"domain", "matchValue": "<email or domain>" }
Supported actionJson: { "targetAttention": one of ${JSON.stringify(ATTENTION_VALUES)} }
confidence: 0.0–1.0 (how certain you are about the interpretation)

User rule: "${plainText}"

Respond with ONLY valid JSON matching this shape:
{ "ruleType": "attention", "conditionsJson": {...}, "actionJson": {...}, "confidence": 0.0 }`

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  })

  const raw = completion.choices[0]?.message?.content?.trim() ?? ""
  try {
    const parsed = JSON.parse(raw)
    return {
      ruleType: parsed.ruleType ?? "attention",
      conditionsJson: parsed.conditionsJson ?? {},
      actionJson: parsed.actionJson ?? {},
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
