import { applyLabelFeedbackCore } from "@/lib/agent/label-feedback-core"
import { FLOWDESK_LABEL_NAMES, type FlowDeskLabelName } from "@/lib/email-labels"

const FLOWDESK_SET = new Set<string>(FLOWDESK_LABEL_NAMES)

// Snapshot of a conversation's apply_labels projection job as it stood BEFORE
// the current delta run's work-item sync. The sync captures this (see
// runOutlookDeltaSync) because work-item sync re-projects during the same run:
// queueFlowDeskLabelWriteback's upsert rewrites the job payload, so a post-run
// read would diff the delta's category snapshot against a payload NEWER than
// it and fabricate phantom "user removed X" corrections. `settled` is false
// while the pre-run job was still pending/processing — the mailbox
// legitimately lags the desired set then, and any diff would be noise.
export type OutlookProjectionSnapshot = {
  settled: boolean
  labels: FlowDeskLabelName[]
}

// Outlook's delta feed reports each changed message's full current categories
// rather than add/remove events, so user edits are detected by diffing the
// message's FlowDesk categories against the set FlowDesk had projected when
// the user edited — the PRE-RUN apply_labels payload supplied by the sync.
// No settled pre-run projection (null snapshot, or job still in flight) →
// nothing trustworthy to diff against → ignore.
export async function applyOutlookCategoryFeedback(input: {
  tenantId: string
  conversationId: string
  messageCategories: string[]
  priorJob: OutlookProjectionSnapshot | null
}): Promise<{ applied: boolean }> {
  if (!input.priorJob || !input.priorJob.settled) return { applied: false }

  const desired = new Set<string>(input.priorJob.labels)
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
