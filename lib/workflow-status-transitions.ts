import { ConversationStatus } from "@prisma/client"

import type { WorkflowStatus } from "@/lib/workflow-status"

export type SettableWorkflowStatus = Exclude<WorkflowStatus, "draft_ready">

export function conversationUpdateForWorkflowStatus(
  workflowStatus: SettableWorkflowStatus,
  now = new Date(),
) {
  const update: {
    userState: string | null
    userStateSource: string
    userStateUpdatedAt: Date
    status?: ConversationStatus
    readAt?: Date
    gmailUnread?: boolean
  } = {
    userState: workflowStatus === "needs_reply" ? null : workflowStatus,
    userStateSource: "user",
    userStateUpdatedAt: now,
  }

  if (workflowStatus === "done") {
    update.status = ConversationStatus.closed
    update.readAt = now
    update.gmailUnread = false
  } else if (workflowStatus === "waiting_on") {
    update.status = ConversationStatus.in_progress
  } else if (workflowStatus === "needs_reply") {
    update.status = ConversationStatus.needs_reply
  }

  return update
}

export function conversationUpdateForDraftReady() {
  return {
    status: ConversationStatus.needs_reply,
  }
}
