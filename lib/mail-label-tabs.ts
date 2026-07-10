import { FLOWDESK_GMAIL_LABEL_NAMES, type FlowDeskGmailLabelName } from "@/lib/gmail-labels"
import type { WorkflowStatus } from "@/lib/workflow-status"

// Mail's desktop tab strip mirrors the Gmail label vocabulary 1:1 (plus an
// app-only "All") so the tabs a user clicks here are exactly the labels that
// show up in their Gmail sidebar — no separate, drifting taxonomy. Keep this
// in sync with lib/gmail-labels.ts's FLOWDESK_GMAIL_LABEL_NAMES; the mapping
// from label name to tab value is mechanical (lowercase, spaces to
// underscores) so a new label automatically gets a matching tab value.
export type MailLabelTabValue =
  | "all"
  | "needs_reply"
  | "needs_action"
  | "waiting_on"
  | "read_later"
  | "handled"
  | "autodrafted"
  | "newsletter"
  | "marketing"
  | "notification"
  | "calendar"

export type MailLabelTab = {
  value: MailLabelTabValue
  label: "All" | FlowDeskGmailLabelName
  gmailLabel: FlowDeskGmailLabelName | null
}

export type MailLabelTabInput = {
  workflowStatus: WorkflowStatus
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

function labelToTabValue(label: FlowDeskGmailLabelName): MailLabelTabValue {
  return label.toLowerCase().replaceAll(" ", "_") as MailLabelTabValue
}

export const MAIL_LABEL_TABS: MailLabelTab[] = [
  { value: "all", label: "All", gmailLabel: null },
  ...FLOWDESK_GMAIL_LABEL_NAMES.map((label) => ({
    value: labelToTabValue(label),
    label,
    gmailLabel: label,
  })),
]

/**
 * Does this conversation belong on the given label tab? Mirrors
 * flowDeskLabelsForConversationState in lib/gmail-labels.ts exactly, just as
 * a per-tab boolean predicate instead of a full label array, so Mail's tabs
 * always agree with the Gmail labels actually applied to a thread.
 */
export function matchesMailLabelTab(tab: MailLabelTabValue, input: MailLabelTabInput): boolean {
  switch (tab) {
    case "all":
      return true
    case "needs_reply":
      return input.workflowStatus === "needs_reply" || input.workflowStatus === "draft_ready"
    case "needs_action":
      return input.attentionCategory === "needs_action"
    case "waiting_on":
      return input.workflowStatus === "waiting_on"
    case "read_later":
      return input.workflowStatus === "read_later"
    case "handled":
      return input.workflowStatus === "done"
    case "autodrafted":
      return (
        input.workflowStatus === "draft_ready" ||
        input.draftStatus === "proposed" ||
        input.draftStatus === "approved"
      )
    case "newsletter":
      return input.emailType === "newsletter"
    case "marketing":
      return input.emailType === "marketing"
    case "notification":
      return input.emailType === "notification" || input.emailType === "fyi"
    case "calendar":
      return input.emailType === "calendar"
    default:
      return false
  }
}

const MAIL_LABEL_TAB_VALUES = new Set<string>(MAIL_LABEL_TABS.map((t) => t.value))

/**
 * Resolves the active label tab from a request's query params, preferring
 * the new `label` param and falling back to the legacy `tab` param so old
 * bookmarked/shared `/mail?tab=...` links keep working. Two legacy tab
 * values no longer have a direct counterpart in the canonical Gmail label
 * vocabulary (see lib/gmail-labels.ts's FLOWDESK_GMAIL_LABEL_NAMES comment):
 * "important" (now in-app-only, not a Gmail label) folds to "all", and
 * "other" folds to "handled" (its closest surviving bucket). Any other
 * unrecognized value also falls back to "all".
 */
export function coerceMailLabelTab(input: { label?: string; tab?: string }): MailLabelTabValue {
  const raw = input.label ?? input.tab ?? "all"
  if (raw === "other") return "handled"
  if (raw === "important") return "all"
  return MAIL_LABEL_TAB_VALUES.has(raw) ? (raw as MailLabelTabValue) : "all"
}

export function buildMailLabelTabWhere(tab: MailLabelTabValue | null | undefined): Record<string, unknown> | null {
  switch (tab) {
    case "needs_reply":
      return {
        OR: [
          { status: "needs_reply" },
          { draft: { is: { status: "proposed" } } },
        ],
      }
    case "needs_action":
      // attentionCategory() in AppListColumn.tsx falls back to
      // stateRecord.metadataJson.attentionCategory when the stateRecord
      // column itself is null (a known column/JSON desync — see
      // lib/agent/automation-runner.ts). Match both so legacy rows whose
      // column hasn't been backfilled still surface here.
      return {
        OR: [
          { stateRecord: { is: { attentionCategory: "needs_action" } } },
          {
            stateRecord: {
              is: { metadataJson: { path: ["attentionCategory"], equals: "needs_action" } },
            },
          },
        ],
      }
    case "waiting_on":
      // Same column/JSON desync as needs_action above: attentionCategory()
      // falls back to metadataJson.attentionCategory when the stateRecord
      // column is null, and that helper feeds deriveWorkflowStatus for every
      // tab — so this branch is needed here too.
      return {
        OR: [
          { userState: "waiting_on" },
          { status: "in_progress" },
          { stateRecord: { is: { attentionCategory: "waiting_on" } } },
          {
            stateRecord: {
              is: { metadataJson: { path: ["attentionCategory"], equals: "waiting_on" } },
            },
          },
        ],
      }
    case "read_later":
      // Same column/JSON desync as needs_action/waiting_on above.
      return {
        OR: [
          { userState: "read_later" },
          { stateRecord: { is: { attentionCategory: "read_later" } } },
          {
            stateRecord: {
              is: { metadataJson: { path: ["attentionCategory"], equals: "read_later" } },
            },
          },
        ],
      }
    case "handled":
      // workflowStatus becomes "done" (deriveWorkflowStatus, lib/workflow-status.ts)
      // via userState/status *or* independently via a "quiet"/"fyi_done"
      // attentionCategory or a notification/newsletter/marketing emailType,
      // with no status/userState involved in those two paths at all — so
      // both branches are required here too, or FYI-typed rows silently
      // disappear from this tab (and its count) before matchesMailLabelTab
      // ever sees them.
      return {
        OR: [
          { userState: "done" },
          { status: "closed" },
          { stateRecord: { is: { attentionCategory: { in: ["quiet", "fyi_done"] } } } },
          { stateRecord: { is: { emailType: { in: ["notification", "newsletter", "marketing"] } } } },
        ],
      }
    case "autodrafted":
      return {
        OR: [
          { draft: { is: { status: "proposed" } } },
          { draft: { is: { status: "approved" } } },
        ],
      }
    case "newsletter":
      return { stateRecord: { is: { emailType: "newsletter" } } }
    case "marketing":
      return { stateRecord: { is: { emailType: "marketing" } } }
    case "notification":
      return { stateRecord: { is: { emailType: { in: ["notification", "fyi"] } } } }
    case "calendar":
      return { stateRecord: { is: { emailType: "calendar" } } }
    default:
      return null
  }
}
