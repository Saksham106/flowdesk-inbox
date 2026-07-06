import { prisma } from "@/lib/prisma"
import type { AttentionCategory } from "@/lib/agent/email-classifier"

/**
 * Static-first rule evaluation (Gmail-native plan Phase 2 P0).
 *
 * Deterministic sender/domain/subject/body matching that runs BEFORE any LLM
 * classification. A static match short-circuits the classifier: no model
 * call, no AI budget spend. AgentRule conditions extend the existing
 * `{ matchType, matchValue }` shape with optional `subjectContains` /
 * `bodyContains`; SenderRule stays sender-only.
 *
 * Precedence (mirrors lib/agent/preference-learning.ts):
 * AgentRule over SenderRule; within each, exact email over domain over
 * content-only conditions. All conditions on one rule are AND-ed.
 */

const ATTENTION_VALUES: readonly string[] = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

export type StaticRuleConditions = {
  matchType?: "email" | "domain"
  matchValue?: string
  subjectContains?: string
  bodyContains?: string
}

export type StaticRuleMatch = {
  ruleSource: "agent_rule" | "sender_rule"
  ruleId: string
  ruleVersion: number
  targetAttention: AttentionCategory
  evidence: string[]
}

export type StaticMatchInput = {
  fromEmail: string
  subject: string
  body: string
}

function domainOf(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().replace(/[^a-z0-9._-]/g, "") : ""
}

/** Normalizes a conditionsJson blob; null when it holds no usable static condition. */
export function parseStaticConditions(json: unknown): StaticRuleConditions | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null
  const rec = json as Record<string, unknown>
  const out: StaticRuleConditions = {}

  if (rec.matchType === "email" || rec.matchType === "domain") {
    if (typeof rec.matchValue === "string" && rec.matchValue.trim()) {
      out.matchType = rec.matchType
      out.matchValue = rec.matchValue.trim().toLowerCase().replace(/^@/, "")
    }
  } else if (rec.matchType !== undefined) {
    return null
  }
  if (typeof rec.subjectContains === "string" && rec.subjectContains.trim()) {
    out.subjectContains = rec.subjectContains.trim()
  }
  if (typeof rec.bodyContains === "string" && rec.bodyContains.trim()) {
    out.bodyContains = rec.bodyContains.trim()
  }

  return out.matchValue || out.subjectContains || out.bodyContains ? out : null
}

export function matchStaticConditions(
  conditions: StaticRuleConditions,
  message: StaticMatchInput
): { matched: boolean; evidence: string[] } {
  const evidence: string[] = []
  const fromEmail = message.fromEmail.trim().toLowerCase()
  let hasCondition = false

  if (conditions.matchType && conditions.matchValue) {
    hasCondition = true
    if (conditions.matchType === "email") {
      if (fromEmail !== conditions.matchValue) return { matched: false, evidence: [] }
      evidence.push(`sender is ${conditions.matchValue}`)
    } else {
      if (domainOf(fromEmail) !== conditions.matchValue) return { matched: false, evidence: [] }
      evidence.push(`sender domain is ${conditions.matchValue}`)
    }
  }

  if (conditions.subjectContains) {
    hasCondition = true
    const needle = conditions.subjectContains.toLowerCase()
    if (!message.subject || !message.subject.toLowerCase().includes(needle)) {
      return { matched: false, evidence: [] }
    }
    evidence.push(`subject contains "${conditions.subjectContains.toLowerCase()}"`)
  }

  if (conditions.bodyContains) {
    hasCondition = true
    const needle = conditions.bodyContains.toLowerCase()
    if (!message.body || !message.body.toLowerCase().includes(needle)) {
      return { matched: false, evidence: [] }
    }
    evidence.push(`body contains "${conditions.bodyContains.toLowerCase()}"`)
  }

  return hasCondition ? { matched: true, evidence } : { matched: false, evidence: [] }
}

// Lower rank wins. Email conditions are the most specific, then domain,
// then content-only (subject/body without a sender condition).
function conditionRank(conditions: StaticRuleConditions): number {
  if (conditions.matchType === "email") return 0
  if (conditions.matchType === "domain") return 1
  return 2
}

type AgentRuleRow = {
  id: string
  version: number
  ruleType: string
  conditionsJson: unknown
  actionJson: unknown
}

type SenderRuleRow = {
  id: string
  version: number
  matchType: string
  matchValue: string
  targetAttention: string
}

/**
 * Evaluates all active static rules for a tenant against one message.
 * Returns the winning match or null. Read-only: never mutates anything.
 */
export async function evaluateStaticRules(input: {
  tenantId: string
  fromEmail: string
  subject: string
  body: string
}): Promise<StaticRuleMatch | null> {
  const [agentRules, senderRules] = await Promise.all([
    prisma.agentRule.findMany({
      where: { tenantId: input.tenantId, status: "active", ruleType: "attention" },
      select: { id: true, version: true, ruleType: true, conditionsJson: true, actionJson: true },
      orderBy: { createdAt: "asc" },
    }) as Promise<AgentRuleRow[]>,
    prisma.senderRule.findMany({
      where: { tenantId: input.tenantId, status: "active" },
      select: { id: true, version: true, matchType: true, matchValue: true, targetAttention: true },
      orderBy: { createdAt: "asc" },
    }) as Promise<SenderRuleRow[]>,
  ])

  const message: StaticMatchInput = {
    fromEmail: input.fromEmail,
    subject: input.subject,
    body: input.body,
  }

  let best: { rank: number; match: StaticRuleMatch } | null = null
  for (const rule of agentRules) {
    const action = rule.actionJson as Record<string, unknown> | null
    const targetAttention = action?.targetAttention
    if (typeof targetAttention !== "string" || !ATTENTION_VALUES.includes(targetAttention)) continue
    const conditions = parseStaticConditions(rule.conditionsJson)
    if (!conditions) continue
    const { matched, evidence } = matchStaticConditions(conditions, message)
    if (!matched) continue
    const rank = conditionRank(conditions)
    if (!best || rank < best.rank) {
      best = {
        rank,
        match: {
          ruleSource: "agent_rule",
          ruleId: rule.id,
          ruleVersion: rule.version,
          targetAttention: targetAttention as AttentionCategory,
          evidence,
        },
      }
      if (rank === 0) break
    }
  }
  if (best) return best.match

  for (const rule of senderRules) {
    if (!ATTENTION_VALUES.includes(rule.targetAttention)) continue
    const conditions = parseStaticConditions({ matchType: rule.matchType, matchValue: rule.matchValue })
    if (!conditions) continue
    const { matched, evidence } = matchStaticConditions(conditions, message)
    if (!matched) continue
    const rank = conditionRank(conditions)
    if (!best || rank < best.rank) {
      best = {
        rank,
        match: {
          ruleSource: "sender_rule",
          ruleId: rule.id,
          ruleVersion: rule.version,
          targetAttention: rule.targetAttention as AttentionCategory,
          evidence,
        },
      }
      if (rank === 0) break
    }
  }
  return best?.match ?? null
}
