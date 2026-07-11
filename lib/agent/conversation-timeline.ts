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

type ProviderLabel = "Gmail" | "Outlook"

/** Shared renderer for `{gmail,outlook}.labels.queued` — same shape, provider-named wording. */
function labelsQueuedEntry(p: Payload, providerLabel: ProviderLabel): Omit<TimelineEntry, "id" | "createdAt"> {
  const labels = strList(p.labels)
  return {
    icon: "🏷",
    title: `Queued ${providerLabel} labels`,
    detail: labels.length > 0 ? labels.join(", ") : "Remove FlowDesk labels",
    why: null,
    tone: "muted",
  }
}

/** Shared renderer for `{gmail,outlook}.writeback.completed`. */
function writebackCompletedEntry(p: Payload, providerLabel: ProviderLabel): Omit<TimelineEntry, "id" | "createdAt"> {
  const action = str(p.action)
  const labels = strList(p.labels)
  const detailParts: string[] = []
  if (labels.length > 0) detailParts.push(labels.join(", "))
  else if (str(p.reason)) detailParts.push(str(p.reason) as string)
  else if (str(p.result)) detailParts.push(str(p.result) as string)
  return {
    icon: "🏷",
    title: action ? `${humanize(action)} in ${providerLabel}` : `${providerLabel} action applied`,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    why: null,
    tone: str(p.result) === "skipped" ? "muted" : "success",
  }
}

/** Shared renderer for `{gmail,outlook}.writeback.failed`. */
function writebackFailedEntry(p: Payload, providerLabel: ProviderLabel): Omit<TimelineEntry, "id" | "createdAt"> {
  const action = str(p.action)
  const attempts = num(p.attempts)
  const bits: string[] = []
  if (str(p.error)) bits.push(str(p.error) as string)
  if (attempts) bits.push(`${attempts} attempts`)
  return {
    icon: "⚠",
    title: action ? `${humanize(action)} failed in ${providerLabel}` : `${providerLabel} action failed`,
    detail: bits.length > 0 ? bits.join(" · ") : null,
    why: null,
    tone: "danger",
  }
}

/** Shared renderer for `{gmail,outlook}.draft.queued`. */
function draftQueuedEntry(providerLabel: ProviderLabel): Omit<TimelineEntry, "id" | "createdAt"> {
  return {
    icon: "✉",
    title: `Draft written to ${providerLabel}`,
    detail: null,
    why: null,
    tone: "muted",
  }
}

/** Shared renderer for `{gmail,outlook}.draft.withdraw_queued`. */
function draftWithdrawQueuedEntry(providerLabel: ProviderLabel): Omit<TimelineEntry, "id" | "createdAt"> {
  return {
    icon: "✉",
    title: `Removed the ${providerLabel} draft`,
    detail: null,
    why: null,
    tone: "muted",
  }
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
  "gmail.labels.queued": (p) => labelsQueuedEntry(p, "Gmail"),
  "outlook.labels.queued": (p) => labelsQueuedEntry(p, "Outlook"),
  "gmail.writeback.completed": (p) => writebackCompletedEntry(p, "Gmail"),
  "outlook.writeback.completed": (p) => writebackCompletedEntry(p, "Outlook"),
  "gmail.writeback.failed": (p) => writebackFailedEntry(p, "Gmail"),
  "outlook.writeback.failed": (p) => writebackFailedEntry(p, "Outlook"),
  "gmail.draft.queued": () => draftQueuedEntry("Gmail"),
  "outlook.draft.queued": () => draftQueuedEntry("Outlook"),
  "gmail.draft.withdraw_queued": () => draftWithdrawQueuedEntry("Gmail"),
  "outlook.draft.withdraw_queued": () => draftWithdrawQueuedEntry("Outlook"),
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
    detail: "Still marked Waiting On — no reply yet",
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
  "scheduling_session.confirmed": (p, row) => ({
    icon: "📅",
    title: "Meeting time confirmed",
    detail: str(p.label) ?? str(p.confirmedTime),
    why:
      str(p.detectedFrom) === "inbound_reply"
        ? null
        : { kind: "manual", by: row.userEmail },
    tone: "success",
  }),
  "scheduling_session.booking_approval_requested": (p) => ({
    icon: "⏸",
    title: "Booking held for your approval",
    detail: str(p.label),
    why: null,
    tone: "warning",
  }),
  "scheduling_session.booked": (p, row) => ({
    icon: "📅",
    title:
      str(p.trigger) === "auto"
        ? "Auto-booked the calendar event"
        : "Calendar event booked",
    detail: p.holdConverted === true ? "Converted the tentative hold" : null,
    why: row.userEmail ? { kind: "manual", by: row.userEmail } : null,
    tone: "success",
  }),
  "scheduling_session.booking_failed": (p) => ({
    icon: "⚠",
    title: "Calendar booking failed",
    detail: str(p.error),
    why: null,
    tone: "danger",
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
