import type { WorkflowStatus } from "@/lib/workflow-status"

export type MailTopTabValue = "important" | "needs_reply" | "waiting_on" | "read_later" | "other" | "calendar"

export const MAIL_TOP_TABS: { value: MailTopTabValue; label: string }[] = [
  { value: "important", label: "Important" },
  { value: "needs_reply", label: "Needs Reply" },
  { value: "waiting_on", label: "Waiting On" },
  { value: "read_later", label: "Read Later" },
  { value: "other", label: "Other" },
  { value: "calendar", label: "Calendar" },
]

export type MailTopTabInput = {
  workflowStatus: WorkflowStatus
  emailType: string | null
  /** VIP/priority signal — Phase 1 computes "Important" from this only, no new persisted field. */
  isVip: boolean
}

/**
 * Does this conversation belong on the given top tab? Draft Ready
 * (workflowStatus === "draft_ready") counts under needs_reply — it still
 * needs the user's attention.
 */
export function matchesMailTopTab(tab: MailTopTabValue, input: MailTopTabInput): boolean {
  switch (tab) {
    case "important":
      return input.isVip
    case "needs_reply":
      return input.workflowStatus === "needs_reply" || input.workflowStatus === "draft_ready"
    case "waiting_on":
      return input.workflowStatus === "waiting_on"
    case "read_later":
      return input.workflowStatus === "read_later"
    case "calendar":
      return input.emailType === "calendar"
    case "other":
      return (
        input.workflowStatus === "done" &&
        input.emailType !== "calendar" &&
        !input.isVip
      )
    default:
      return false
  }
}

export function buildMailTopTabWhere(tab: MailTopTabValue | null | undefined): Record<string, unknown> | null {
  switch (tab) {
    case "important":
      return {
        stateRecord: {
          is: {
            metadataJson: { path: ["isVip"], equals: true },
          },
        },
      }
    case "needs_reply":
      return {
        OR: [
          { status: "needs_reply" },
          { draft: { is: { status: "proposed" } } },
        ],
      }
    case "waiting_on":
      return {
        OR: [
          { userState: "waiting_on" },
          { status: "in_progress" },
          { stateRecord: { is: { attentionCategory: "waiting_on" } } },
        ],
      }
    case "read_later":
      return {
        OR: [
          { userState: "read_later" },
          { stateRecord: { is: { attentionCategory: "read_later" } } },
        ],
      }
    case "calendar":
      return { stateRecord: { is: { emailType: "calendar" } } }
    case "other":
      return {
        OR: [
          { userState: "done" },
          { status: "closed" },
          { stateRecord: { is: { attentionCategory: { in: ["quiet", "fyi_done"] } } } },
          { stateRecord: { is: { emailType: { in: ["notification", "newsletter", "marketing"] } } } },
        ],
        NOT: [
          { stateRecord: { is: { emailType: "calendar" } } },
          { stateRecord: { is: { metadataJson: { path: ["isVip"], equals: true } } } },
        ],
      }
    default:
      return null
  }
}
