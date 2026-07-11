import type { FlowDeskGmailLabelName } from "@/lib/email-labels"

// Pure view helpers for the /assistant pages (Rules summary tiles, Test
// Rules planned-label preview). No Prisma here — callers fetch/map rows,
// these just shape them for display.

type RuleLike = {
  status: string
  source: string
  lastDryRunAt: string | null
}

export type AssistantRuleSummary = {
  active: number
  draft: number
  manual: number
  learned: number
  lastDryRunAt: string | null
}

// A small, purpose-built targetAttention -> visible-label mapping for
// previewing a rule's action before it runs. This is intentionally narrower
// than flowDeskLabelsForConversationState (lib/gmail-labels.ts), which
// derives labels from a conversation's full workflow/draft/content state —
// here we only have a rule's single targetAttention value to go on. Values
// are ATTENTION_VALUES from app/api/agent-rules/dry-run/route.ts.
// "review_soon" has no dedicated Gmail label; deriveWorkflowStatus
// (lib/workflow-status.ts) has no case for it either and falls through to
// "needs_reply", so it's mapped the same way here for consistency.
//
// This previews only the attention-target's own label — it does not derive
// content-type labels (Newsletter/Marketing/…) or Autodrafted the way
// flowDeskLabelsForConversationState does from full conversation state.
// Don't mistake it for a mirror of that pipeline; it's a narrower, static
// preview keyed off a rule's targetAttention alone.
export function plannedLabelsForRuleAction(
  actionJson: Record<string, unknown>
): FlowDeskGmailLabelName[] {
  const targetAttention =
    typeof actionJson.targetAttention === "string" ? actionJson.targetAttention : null

  switch (targetAttention) {
    case "needs_reply":
    case "review_soon":
      return ["Needs Reply"]
    case "needs_action":
      return ["Needs Action"]
    case "waiting_on":
      return ["Waiting On"]
    case "read_later":
      return ["Read Later"]
    case "quiet":
    case "fyi_done":
    case "done":
      return ["Handled"]
    default:
      return []
  }
}

// Chips describing what a rule does, for the Rules table's Action column.
// AgentRule.actionJson only ever carries `targetAttention` in this codebase
// (see lib/agent/rule-compiler.ts and the manual-rule POST handler in
// app/api/agent-rules/route.ts) — there is no gmailLabels/createDraft/archive
// field to read. Chips are derived from the same attention -> Gmail label
// mapping used for the dry-run preview so the Rules table and Test Rules
// results describe the same outcome.
export function actionChipsForRule(actionJson: Record<string, unknown>): string[] {
  return plannedLabelsForRuleAction(actionJson).map((label) => `Label as '${label}'`)
}

// Action string literals verified against the AuditLog.create() call sites in
// app/api/agent-rules/route.ts, app/api/agent-rules/[id]/route.ts,
// app/api/agent-rules/[id]/versions/route.ts, and
// app/api/agent-rules/dry-run/route.ts.
export function describeRuleAuditAction(action: string): string {
  switch (action) {
    case "agent_rule.create":
      return "Rule created"
    case "agent_rule.update":
      return "Rule updated"
    case "agent_rule.version_snapshot":
      return "Version saved"
    case "agent_rule.delete":
      return "Rule deleted"
    case "agent_rule.dry_run":
      return "Rule tested"
    default:
      return action
  }
}

// payloadJson shapes (see the route files above): create uses `ruleId`,
// update/delete use `id`, version_snapshot/dry_run use `ruleId` + `version`.
// Normalize to a single secondary line rather than a full diff viewer — the
// payload doesn't carry enough of a before/after shape to justify one.
export function ruleContextFromAuditPayload(payloadJson: unknown): string | null {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) return null
  const payload = payloadJson as Record<string, unknown>
  const ruleId = payload.ruleId ?? payload.id
  if (typeof ruleId !== "string") return null
  const version = typeof payload.version === "number" ? payload.version : null
  return version !== null ? `Rule ${ruleId} · v${version}` : `Rule ${ruleId}`
}

// A short human-readable summary of what happened, distinct from the rule
// identifier context above. Only dry_run and create/update payloads carry
// enough structured detail to summarize meaningfully; other actions fall
// back to no summary rather than dumping raw JSON.
export function ruleAuditPayloadSummary(action: string, payloadJson: unknown): string | null {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) return null
  const payload = payloadJson as Record<string, unknown>

  if (action === "agent_rule.dry_run") {
    const sampleSize = typeof payload.sampleSize === "number" ? payload.sampleSize : null
    const matchedCount = typeof payload.matchedCount === "number" ? payload.matchedCount : null
    if (sampleSize !== null && matchedCount !== null) {
      return `${matchedCount} of ${sampleSize} sampled conversations matched`
    }
    return null
  }

  const targetAttention = typeof payload.targetAttention === "string" ? payload.targetAttention : null
  return targetAttention ? `→ ${targetAttention.replace(/_/g, " ")}` : null
}

export function summarizeAssistantRules(rules: RuleLike[]): AssistantRuleSummary {
  const lastDryRunAt =
    rules
      .map((r) => r.lastDryRunAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null

  return {
    active: rules.filter((r) => r.status === "active").length,
    draft: rules.filter((r) => r.status === "draft").length,
    manual: rules.filter((r) => r.source === "manual").length,
    learned: rules.filter((r) => r.source === "learned").length,
    lastDryRunAt,
  }
}
