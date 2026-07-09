import type { FlowDeskGmailLabelName } from "@/lib/gmail-labels"

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
