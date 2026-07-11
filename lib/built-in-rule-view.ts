import { FLOWDESK_GMAIL_LABEL_NAMES, type FlowDeskGmailLabelName } from "@/lib/email-labels"

const DESCRIPTION: Record<FlowDeskGmailLabelName, string> = {
  "Needs Reply": "Messages waiting for you to reply.",
  "Needs Action": "Messages that require a task or decision.",
  "Waiting On": "Conversations where someone else owes the next response.",
  "Read Later": "Useful mail saved for later reading.",
  Handled: "Messages that are complete and need no more work.",
  Autodrafted: "Messages where FlowDesk prepared a draft.",
  Newsletter: "Recurring editorial or subscribed content.",
  Marketing: "Offers, promotions, and product announcements.",
  Notification: "Automated updates and informational notices.",
  Calendar: "Meeting invitations and calendar updates.",
}

export function builtInRuleRows(mappings: Array<{ canonical: string; enabled: boolean }>) {
  const enabledByCanonical = new Map(mappings.map((mapping) => [mapping.canonical, mapping.enabled]))
  return FLOWDESK_GMAIL_LABEL_NAMES.map((label) => ({
    label,
    description: DESCRIPTION[label],
    enabled: enabledByCanonical.get(label) ?? true,
  }))
}
