import { prisma } from "@/lib/prisma"
import { applyLabelFeedbackCore } from "@/lib/agent/label-feedback-core"
import {
  FLOWDESK_LABEL_NAMES,
  normalizeFlowDeskLabelPayload,
} from "@/lib/email-labels"

const FLOWDESK_SET = new Set<string>(FLOWDESK_LABEL_NAMES)

// Outlook's delta feed reports each changed message's full current categories
// rather than add/remove events, so user edits are detected by diffing the
// message's FlowDesk categories against the set FlowDesk last projected (the
// conversation's apply_labels queue payload). Only runs once that job has
// settled (completed/acknowledged/failed): while a projection is pending or
// processing, the mailbox legitimately lags the desired set and any diff
// would be a phantom "user edit". No settled projection → nothing to diff
// against (FlowDesk never labeled this thread) → ignore.
export async function applyOutlookCategoryFeedback(input: {
  tenantId: string
  conversationId: string
  messageCategories: string[]
  // Start of the delta run that captured `messageCategories`. If the projection
  // job was (re)written at/after this instant, it settled during this same run
  // with a payload that post-dates the snapshot — diffing the two would
  // fabricate phantom corrections, so skip. Tradeoff: a genuine user edit
  // landing in the same delta page as a classification change is skipped this
  // run (correctness over completeness); the next delta re-observes it.
  jobNotUpdatedSince?: Date
}): Promise<{ applied: boolean }> {
  const job = await prisma.emailWritebackQueue.findUnique({
    where: {
      conversationId_action: { conversationId: input.conversationId, action: "apply_labels" },
    },
    select: { status: true, providerMessageIdsJson: true, updatedAt: true },
  })
  if (!job || job.status === "pending" || job.status === "processing") return { applied: false }
  if (input.jobNotUpdatedSince && job.updatedAt >= input.jobNotUpdatedSince) {
    return { applied: false }
  }

  const payload = normalizeFlowDeskLabelPayload(job.providerMessageIdsJson)
  if (!payload) return { applied: false }

  const desired = new Set<string>(payload.labels)
  const actual = input.messageCategories.filter((category) => FLOWDESK_SET.has(category))
  const added = actual.filter((category) => !desired.has(category))
  const removed = [...desired].filter((category) => !actual.includes(category))
  if (added.length === 0 && removed.length === 0) return { applied: false }

  const result = await applyLabelFeedbackCore({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    added,
    removed,
    auditAction: "outlook.labels.corrected",
  })
  return { applied: result.applied }
}
