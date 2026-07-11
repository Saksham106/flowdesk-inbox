// Client-safe display helpers for the canonical FlowDesk label vocabulary.
// Deliberately does NOT import lib/gmail-labels.ts's runtime exports (only
// its type) since that module pulls in prisma — importing it from a "use
// client" component would bundle server-only code into the browser. Keep the
// FLOWDESK_LABEL_OPTIONS list in sync with FLOWDESK_GMAIL_LABEL_NAMES in
// lib/gmail-labels.ts.
import type { FlowDeskGmailLabelName } from "@/lib/email-labels"
import type { WorkflowStatus } from "@/lib/workflow-status"

export const FLOWDESK_LABEL_OPTIONS: { value: FlowDeskGmailLabelName; label: string; dot: string }[] = [
  { value: "Needs Reply",  label: "Needs Reply",  dot: "bg-red-500" },
  { value: "Needs Action", label: "Needs Action", dot: "bg-orange-500" },
  { value: "Waiting On",   label: "Waiting On",   dot: "bg-indigo-400" },
  { value: "Read Later",   label: "Read Later",   dot: "bg-violet-400" },
  { value: "Handled",      label: "Handled",      dot: "bg-emerald-500" },
  { value: "Autodrafted",  label: "Autodrafted",  dot: "bg-blue-400" },
  { value: "Newsletter",   label: "Newsletter",   dot: "bg-slate-400" },
  { value: "Marketing",    label: "Marketing",    dot: "bg-pink-400" },
  { value: "Notification", label: "Notification", dot: "bg-slate-400" },
  { value: "Calendar",     label: "Calendar",     dot: "bg-teal-400" },
]

// Maps the AI-derived attentionCategory / content-type signals a conversation
// is rendered with to the canonical label that should be pre-selected in a
// label picker. Content type (newsletter/marketing/notification/calendar)
// wins when present since it's the more specific classification.
const CONTENT_TYPE_TO_LABEL: Partial<Record<string, FlowDeskGmailLabelName>> = {
  newsletter: "Newsletter",
  marketing: "Marketing",
  notification: "Notification",
  calendar: "Calendar",
}

const ATTENTION_TO_LABEL: Partial<Record<string, FlowDeskGmailLabelName>> = {
  needs_reply: "Needs Reply",
  needs_action: "Needs Action",
  waiting_on: "Waiting On",
  read_later: "Read Later",
  fyi_done: "Handled",
  quiet: "Handled",
}

export function currentFlowDeskLabel(
  attentionCategory: string | null | undefined,
  contentType: string | null | undefined,
  workflowStatus: WorkflowStatus
): FlowDeskGmailLabelName {
  if (contentType && CONTENT_TYPE_TO_LABEL[contentType]) {
    return CONTENT_TYPE_TO_LABEL[contentType] as FlowDeskGmailLabelName
  }
  if (attentionCategory && ATTENTION_TO_LABEL[attentionCategory]) {
    return ATTENTION_TO_LABEL[attentionCategory] as FlowDeskGmailLabelName
  }
  if (workflowStatus === "draft_ready") return "Autodrafted"
  if (workflowStatus === "done") return "Handled"
  if (workflowStatus === "waiting_on") return "Waiting On"
  if (workflowStatus === "read_later") return "Read Later"
  return "Needs Reply"
}
