/**
 * Pure builder for the per-conversation "What FlowDesk did & why" timeline.
 *
 * Like `command-center.ts`, this module accepts pre-fetched plain objects and
 * never touches Prisma, so it stays independently unit-testable. It reads the
 * audit rows already written by the agent/writeback/lifecycle paths and turns
 * them into a compact, human-readable timeline that surfaces the "why this
 * automation fired" metadata (rule id/version/evidence, AI confidence, provider
 * result) that otherwise only lives in raw audit payloads.
 */

export type TimelineAuditRow = {
  id: string
  action: string
  createdAt: Date
  payloadJson: unknown
  /** The acting user's email, or null for system/automated actions. */
  userEmail: string | null
}

export type TimelineWhy =
  | {
      kind: "rule"
      ruleSource: string
      ruleId: string
      ruleVersion: number
      evidence: string[]
    }
  | { kind: "ai"; confidence: number | null; intent: string | null }
  | { kind: "manual"; by: string | null }
  | null

export type TimelineTone = "info" | "success" | "warning" | "danger" | "muted"

export type TimelineEntry = {
  id: string
  icon: string
  title: string
  detail: string | null
  why: TimelineWhy
  tone: TimelineTone
  createdAt: Date
}

type Payload = Record<string, unknown>

function asPayload(value: unknown): Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : {}
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

function humanize(value: string): string {
  return value.replace(/[_.]/g, " ").trim()
}

function classificationWhy(p: Payload): TimelineWhy {
  if (p.classificationSource === "static_rule" && str(p.ruleId)) {
    return {
      kind: "rule",
      ruleSource: str(p.ruleSource) ?? "rule",
      ruleId: str(p.ruleId) as string,
      ruleVersion: num(p.ruleVersion) ?? 1,
      evidence: strList(p.ruleEvidence),
    }
  }
  return { kind: "ai", confidence: num(p.confidence), intent: str(p.intent) }
}

/** One mapper per meaningful audit action; anything unmapped is omitted. */
const MAPPERS: Record<
  string,
  (p: Payload, row: TimelineAuditRow) => Omit<TimelineEntry, "id" | "createdAt">
> = {
  "agent_job.completed": (p) => {
    const intent = str(p.intent)
    return {
      icon: "✦",
      title: intent ? `Classified as ${humanize(intent)}` : "Classified the thread",
      detail: p.requiresApproval ? "Flagged for your approval" : null,
      why: classificationWhy(p),
      tone: "info",
    }
  },
  "agent_job.failed": (p) => ({
    icon: "⚠",
    title: "Classification failed",
    detail: str(p.error),
    why: null,
    tone: "danger",
  }),
  "draft.suggest": () => ({
    icon: "✉",
    title: "Drafted a reply",
    detail: "Ready for your review",
    why: null,
    tone: "info",
  }),
  "draft.suggest.cache_hit": () => ({
    icon: "✉",
    title: "Drafted a reply",
    detail: "Ready for your review",
    why: null,
    tone: "info",
  }),
  "draft.edit": (_, row) => ({
    icon: "✎",
    title: "You edited the draft",
    detail: null,
    why: { kind: "manual", by: row.userEmail },
    tone: "info",
  }),
  "draft.approve": (_, row) => ({
    icon: "✓",
    title: "Draft approved",
    detail: null,
    why: { kind: "manual", by: row.userEmail },
    tone: "success",
  }),
  "draft.sent": (_, row) => ({
    icon: "➤",
    title: "Reply sent",
    detail: null,
    why: row.userEmail ? { kind: "manual", by: row.userEmail } : null,
    tone: "success",
  }),
  "autopilot.send": (p) => ({
    icon: "➤",
    title: "Auto-sent a reply",
    detail: null,
    why: { kind: "ai", confidence: num(p.confidence), intent: str(p.intent) },
    tone: "success",
  }),
  "autopilot.send_failed": (p) => ({
    icon: "⚠",
    title: "Auto-send failed",
    detail: str(p.error) ?? str(p.reason),
    why: null,
    tone: "danger",
  }),
  "autopilot.held": (p) => ({
    icon: "⏸",
    title: "Held for approval instead of auto-sending",
    detail: str(p.reason),
    why: null,
    tone: "warning",
  }),
  "gmail.labels.queued": (p) => {
    const labels = strList(p.labels)
    return {
      icon: "🏷",
      title: "Queued Gmail labels",
      detail: labels.length > 0 ? labels.join(", ") : "Remove FlowDesk labels",
      why: null,
      tone: "muted",
    }
  },
  "gmail.writeback.completed": (p) => {
    const action = str(p.action)
    const labels = strList(p.labels)
    const detailParts: string[] = []
    if (labels.length > 0) detailParts.push(labels.join(", "))
    else if (str(p.reason)) detailParts.push(str(p.reason) as string)
    else if (str(p.result)) detailParts.push(str(p.result) as string)
    return {
      icon: "🏷",
      title: action ? `${humanize(action)} in Gmail` : "Gmail action applied",
      detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
      why: null,
      tone: str(p.result) === "skipped" ? "muted" : "success",
    }
  },
  "gmail.writeback.failed": (p) => {
    const action = str(p.action)
    const attempts = num(p.attempts)
    const bits: string[] = []
    if (str(p.error)) bits.push(str(p.error) as string)
    if (attempts) bits.push(`${attempts} attempts`)
    return {
      icon: "⚠",
      title: action ? `${humanize(action)} failed in Gmail` : "Gmail action failed",
      detail: bits.length > 0 ? bits.join(" · ") : null,
      why: null,
      tone: "danger",
    }
  },
  "gmail.draft.queued": () => ({
    icon: "✉",
    title: "Draft written to Gmail",
    detail: null,
    why: null,
    tone: "muted",
  }),
  "gmail.draft.withdraw_queued": () => ({
    icon: "✉",
    title: "Removed the Gmail draft",
    detail: null,
    why: null,
    tone: "muted",
  }),
  "conversation.waiting_on_detected": () => ({
    icon: "⏳",
    title: "Marked Waiting On a reply",
    detail: null,
    why: null,
    tone: "info",
  }),
  "conversation.waiting_on_cleared": () => ({
    icon: "↩",
    title: "Reply received — back to Needs Reply",
    detail: null,
    why: null,
    tone: "success",
  }),
  "follow_up.due_labeled": () => ({
    icon: "⏰",
    title: "Follow-up is due",
    detail: "Added the Follow Up label",
    why: null,
    tone: "warning",
  }),
  "follow_up.job_created": () => ({
    icon: "⏰",
    title: "Scheduled a follow-up check",
    detail: null,
    why: null,
    tone: "muted",
  }),
  "conversation.attention_corrected": (_, row) => ({
    icon: "✎",
    title: "You corrected the category",
    detail: null,
    why: { kind: "manual", by: row.userEmail },
    tone: "info",
  }),
  "conversation.unsubscribed": () => ({
    icon: "✕",
    title: "Unsubscribed from the sender",
    detail: null,
    why: null,
    tone: "success",
  }),
  "conversation.explained": () => ({
    icon: "✦",
    title: "Generated a thread explanation",
    detail: null,
    why: null,
    tone: "muted",
  }),
  "automation.update_attention": (p) => ({
    icon: "✦",
    title: "Updated the attention category",
    detail: str(p.reason),
    why: null,
    tone: "info",
  }),
  "automation.archive": () => ({
    icon: "📥",
    title: "Archived the thread",
    detail: null,
    why: null,
    tone: "muted",
  }),
  "automation.create_task": (p) => ({
    icon: "☑",
    title: "Created a task",
    detail: str(p.title),
    why: null,
    tone: "info",
  }),
  "meeting_follow_up.draft_created": () => ({
    icon: "✉",
    title: "Drafted a meeting follow-up",
    detail: "Ready for your review",
    why: null,
    tone: "info",
  }),
}

/**
 * Maps conversation-scoped audit rows into a newest-first timeline. Rows whose
 * action is not a meaningful thread action are omitted, keeping the timeline
 * trustworthy rather than a raw audit dump.
 */
export function buildConversationTimeline(rows: TimelineAuditRow[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const row of rows) {
    const mapper = MAPPERS[row.action]
    if (!mapper) continue
    const mapped = mapper(asPayload(row.payloadJson), row)
    entries.push({ id: row.id, createdAt: row.createdAt, ...mapped })
  }

  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}
