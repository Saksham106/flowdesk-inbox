export type WorkflowStatus =
  | "needs_reply"
  | "draft_ready"
  | "waiting_on"
  | "read_later"
  | "done"

export interface DeriveWorkflowStatusInput {
  status: string
  /** Set to "needs_reply" to clear an explicit user choice and re-derive from AI signals. Other values (waiting_on, read_later, done) are respected as-is. */
  userState?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

const FYI_ATTENTION = new Set(["fyi_done", "quiet"])
const FYI_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])

export function deriveWorkflowStatus(input: DeriveWorkflowStatusInput): WorkflowStatus {
  // Explicit user choice wins over all AI signals, including an active draft
  const u = input.userState
  if (u === "waiting_on" || u === "read_later" || u === "done") return u

  // Active draft surfaces when no manual override is set
  if (input.draftStatus === "proposed") return "draft_ready"

  // AI attention category signals
  if (input.attentionCategory === "waiting_on") return "waiting_on"
  if (input.attentionCategory === "read_later") return "read_later"
  if (FYI_ATTENTION.has(input.attentionCategory ?? "")) return "done"

  // Conversation DB status
  if (input.status === "closed") return "done"
  if (input.status === "in_progress") return "waiting_on"

  // Security/alert reviews ("review_soon") aren't replies — without this they
  // fell through to needs_reply. Ranked after the status checks so an
  // already-closed alert stays "done".
  if (input.attentionCategory === "review_soon") return "read_later"

  // Auto-email types
  if (FYI_EMAIL_TYPES.has(input.emailType ?? "")) return "done"

  return "needs_reply"
}

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  needs_reply: "Needs Reply",
  draft_ready: "Draft Ready",
  waiting_on:  "Waiting On",
  read_later:  "Read Later",
  done:        "Done",
}

const AI_CATEGORY_LABELS: Record<string, string> = {
  newsletter: "Newsletter",
  notification: "Notification",
  marketing: "Marketing",
  receipt: "Receipt / Billing",
  billing: "Receipt / Billing",
  security: "Security",
  personal: "Personal",
  job_alert: "Job Alert",
  needs_action: "Needs Action",
  review_soon: "Review Soon",
}

export function aiCategoryLabel(
  attentionCategory: string | null | undefined,
  emailType: string | null | undefined,
): string | null {
  if (attentionCategory && AI_CATEGORY_LABELS[attentionCategory]) {
    return AI_CATEGORY_LABELS[attentionCategory]
  }
  if (emailType && AI_CATEGORY_LABELS[emailType]) {
    return AI_CATEGORY_LABELS[emailType]
  }
  return null
}
