/**
 * Translates AuditLog rows into the plain-English activity feed shown on
 * /history. The audit page (/audit) stays the raw, technical record; this
 * module owns the human-readable projection of it: which actions matter to a
 * user, what sentence each becomes, and which filter bucket it lands in.
 * Pure functions — no prisma — so the mapping is unit-testable.
 */

export type HistoryCategory =
  | "sent"
  | "drafted"
  | "labeled"
  | "swept"
  | "organized"
  | "meetings"
  | "settings"
  | "issues"

export type HistoryEntry = {
  category: HistoryCategory
  /** Plain-English sentence, e.g. `Labeled a thread "Newsletter" in Gmail`. */
  text: string
  conversationId: string | null
}

export const HISTORY_CATEGORY_LABELS: Record<HistoryCategory, string> = {
  sent: "Sent",
  drafted: "Drafts",
  labeled: "Labels",
  swept: "Read & archived",
  organized: "Tasks & follow-ups",
  meetings: "Meetings",
  settings: "Settings",
  issues: "Issues",
}

/**
 * Every audit action the feed can render. The /history query filters on this
 * set so noise rows (queue bookkeeping, per-sync receipts) never load at all.
 */
export const HISTORY_ACTIONS = [
  "autopilot.send",
  "autopilot.held",
  "autopilot.draft_approved",
  "autopilot.draft_held_for_sanitizer",
  "autopilot.disabled_after_failures",
  "draft.suggest",
  "draft.approve",
  "draft.sent",
  "gmail.writeback.completed",
  "gmail.writeback.failed",
  "outlook.writeback.completed",
  "outlook.writeback.failed",
  "automation.auto_triage",
  "automation.create_task",
  "follow_up.job_created",
  "follow_up.due_labeled",
  "conversation.waiting_on_detected",
  "conversation.waiting_on_cleared",
  "calendar_hold.created",
  "calendar_hold.confirmed",
  "calendar_hold.cancelled",
  "scheduling_session.booked",
  "scheduling_session.booking_approval_requested",
  "scheduling_session.booking_failed",
  "automation_level.changed",
] as const

function mailboxName(action: string): string {
  return action.startsWith("outlook.") ? "Outlook" : "Gmail"
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function conversationIdOf(payload: Record<string, unknown>): string | null {
  return str(payload.conversationId)
}

/**
 * A completed writeback is the moment FlowDesk actually changed the mailbox —
 * these are the rows users mean when they ask "what did the agent do in my
 * Gmail". Silent no-ops (skips, already-current drafts) return null.
 */
function describeWritebackCompleted(
  action: string,
  payload: Record<string, unknown>
): HistoryEntry | null {
  const mailbox = mailboxName(action)
  const conversationId = conversationIdOf(payload)
  const result = str(payload.result)

  switch (result) {
    case "labels_applied": {
      const labels = Array.isArray(payload.labels)
        ? (payload.labels as unknown[]).filter((l): l is string => typeof l === "string")
        : []
      return {
        category: "labeled",
        text:
          labels.length > 0
            ? `Labeled a thread ${labels.map((l) => `“${l}”`).join(", ")} in ${mailbox}`
            : `Cleared FlowDesk labels from a thread in ${mailbox}`,
        conversationId,
      }
    }
    case "marked_read":
      return { category: "swept", text: `Marked a conversation read in ${mailbox}`, conversationId }
    case "archived":
      return { category: "swept", text: `Archived a thread in ${mailbox}`, conversationId }
    case "draft_created":
      return { category: "drafted", text: `Added a draft reply to your ${mailbox} drafts`, conversationId }
    case "draft_withdrawn":
      return { category: "drafted", text: `Removed a stale draft from ${mailbox}`, conversationId }
    case "draft_invalidated":
      return {
        category: "drafted",
        text: `Removed an outdated draft from ${mailbox} (a newer message arrived)`,
        conversationId,
      }
    default:
      // skipped / draft_current / unknown results are bookkeeping, not activity
      return null
  }
}

export function describeAuditEvent(
  action: string,
  payloadJson: unknown
): HistoryEntry | null {
  const payload =
    payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)
      ? (payloadJson as Record<string, unknown>)
      : {}
  const conversationId = conversationIdOf(payload)

  switch (action) {
    case "autopilot.send": {
      const intent = str(payload.intent)
      return {
        category: "sent",
        text: intent ? `Sent an automatic reply (${intent})` : "Sent an automatic reply",
        conversationId,
      }
    }
    case "draft.sent":
      return { category: "sent", text: "Sent a reply you approved", conversationId }
    case "draft.approve":
      return { category: "sent", text: "You approved a drafted reply", conversationId }
    case "draft.suggest":
      return { category: "drafted", text: "Drafted a reply for you to review", conversationId }
    case "autopilot.draft_approved":
      return { category: "drafted", text: "Auto-approved a drafted reply for sending", conversationId }
    case "autopilot.draft_held_for_sanitizer":
      return {
        category: "drafted",
        text: "Held a drafted reply for your review (safety check flagged it)",
        conversationId,
      }
    case "autopilot.held": {
      const reason = str(payload.reason)
      return {
        category: "drafted",
        text: reason
          ? `Held an automatic reply for your approval — ${reason}`
          : "Held an automatic reply for your approval",
        conversationId,
      }
    }
    case "autopilot.disabled_after_failures":
      return {
        category: "issues",
        text: "Paused autopilot after repeated send failures",
        conversationId,
      }
    case "gmail.writeback.completed":
    case "outlook.writeback.completed":
      return describeWritebackCompleted(action, payload)
    case "gmail.writeback.failed":
    case "outlook.writeback.failed": {
      const error = str(payload.error)
      const mailbox = mailboxName(action)
      return {
        category: "issues",
        text: error
          ? `Couldn't update ${mailbox} — ${error}`
          : `Couldn't update ${mailbox}`,
        conversationId,
      }
    }
    case "automation.auto_triage": {
      const emailType = str(payload.emailType)
      return {
        category: "swept",
        text: emailType
          ? `Swept a low-risk ${emailType} out of your inbox (marked read and archived)`
          : "Swept a low-risk email out of your inbox (marked read and archived)",
        conversationId,
      }
    }
    case "automation.create_task": {
      const title = str(payload.title)
      return {
        category: "organized",
        text: title ? `Created a task: “${title}”` : "Created a task",
        conversationId,
      }
    }
    case "follow_up.job_created":
      return { category: "organized", text: "Scheduled a follow-up reminder", conversationId }
    case "follow_up.due_labeled":
      return { category: "organized", text: "Flagged a follow-up that came due", conversationId }
    case "conversation.waiting_on_detected":
      return { category: "organized", text: "Noticed you're waiting on someone's reply", conversationId }
    case "conversation.waiting_on_cleared":
      return { category: "organized", text: "They replied — cleared the waiting-on flag", conversationId }
    case "calendar_hold.created":
      return { category: "meetings", text: "Held time slots on your calendar for a meeting", conversationId }
    case "calendar_hold.confirmed":
      return { category: "meetings", text: "Confirmed a meeting time", conversationId }
    case "calendar_hold.cancelled":
      return { category: "meetings", text: "Released held meeting slots", conversationId }
    case "scheduling_session.booked":
      return { category: "meetings", text: "Booked a meeting on your calendar", conversationId }
    case "scheduling_session.booking_approval_requested":
      return { category: "meetings", text: "Asked for your approval to book a meeting", conversationId }
    case "scheduling_session.booking_failed":
      return { category: "issues", text: "Couldn't book a meeting on your calendar", conversationId }
    case "automation_level.changed": {
      const from = payload.from
      const to = payload.to
      return {
        category: "settings",
        text:
          typeof to === "number"
            ? `Automation level changed${typeof from === "number" ? ` from ${from}` : ""} to ${to}`
            : "Automation level changed",
        conversationId,
      }
    }
    default:
      return null
  }
}

/** Actions belonging to a filter category — drives the /history chips. */
export function historyActionsForCategory(category: HistoryCategory): string[] {
  return HISTORY_ACTIONS.filter((action) => {
    // Writeback rows fan out into several categories by payload; include them
    // in every mailbox-shaped bucket and let describeAuditEvent sort/drop.
    if (action.endsWith(".writeback.completed")) {
      return category === "labeled" || category === "swept" || category === "drafted"
    }
    const probe = describeAuditEvent(action, {})
    return probe?.category === category
  })
}
