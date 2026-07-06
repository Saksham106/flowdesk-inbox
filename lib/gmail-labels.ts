import { prisma } from "@/lib/prisma"
import { deriveWorkflowStatus, type WorkflowStatus } from "@/lib/workflow-status"

const LABEL_PREFIX = "FlowDesk/"

export const FLOWDESK_GMAIL_LABEL_NAMES = [
  "FlowDesk/Handle First",
  "FlowDesk/Needs Reply",
  "FlowDesk/Needs Action",
  "FlowDesk/Waiting On",
  "FlowDesk/Follow Up",
  "FlowDesk/Read Later",
  "FlowDesk/Important",
  "FlowDesk/Handled",
  "FlowDesk/Autodrafted",
  "FlowDesk/Low Priority",
] as const

export type FlowDeskGmailLabelName = (typeof FLOWDESK_GMAIL_LABEL_NAMES)[number]

const FLOWDESK_GMAIL_LABEL_SET = new Set<string>(FLOWDESK_GMAIL_LABEL_NAMES)

const IMPORTANT_LOCAL_LABELS = new Set(["Lead", "Pricing", "Complaint"])
const LOW_PRIORITY_ATTENTION = new Set(["quiet", "fyi_done"])
const NEEDS_ACTION_ATTENTION = new Set(["needs_action"])

export function isFlowDeskGmailLabelName(label: string): label is FlowDeskGmailLabelName {
  return FLOWDESK_GMAIL_LABEL_SET.has(label)
}

export function flowDeskLabelsForConversationState(input: {
  workflowStatus: WorkflowStatus
  localLabel?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  followUpDue?: boolean
}): FlowDeskGmailLabelName[] {
  const labels: FlowDeskGmailLabelName[] = []

  switch (input.workflowStatus) {
    case "needs_reply":
      labels.push("FlowDesk/Needs Reply")
      break
    case "draft_ready":
      labels.push("FlowDesk/Needs Reply", "FlowDesk/Autodrafted")
      break
    case "waiting_on":
      labels.push("FlowDesk/Waiting On")
      break
    case "read_later":
      labels.push("FlowDesk/Read Later")
      break
    case "done":
      labels.push("FlowDesk/Handled")
      break
  }

  if (input.attentionCategory === "handle_first") {
    labels.push("FlowDesk/Handle First")
  }
  if (NEEDS_ACTION_ATTENTION.has(input.attentionCategory ?? "")) {
    labels.push("FlowDesk/Needs Action")
  }
  if (LOW_PRIORITY_ATTENTION.has(input.attentionCategory ?? "")) {
    labels.push("FlowDesk/Low Priority")
  }
  if (input.followUpDue) {
    labels.push("FlowDesk/Follow Up")
  }
  if (input.draftStatus === "proposed" || input.draftStatus === "approved") {
    labels.push("FlowDesk/Autodrafted")
  }
  if (input.localLabel && IMPORTANT_LOCAL_LABELS.has(input.localLabel)) {
    labels.push("FlowDesk/Important")
  }

  return Array.from(new Set(labels))
}

// An empty `labels` array is a valid payload meaning "remove all FlowDesk
// labels from the thread"; only a missing threadId or non-array labels field
// makes the payload invalid.
export function normalizeFlowDeskLabelPayload(value: unknown): {
  threadId: string
  labels: FlowDeskGmailLabelName[]
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const threadId = typeof payload.threadId === "string" ? payload.threadId : ""
  if (!threadId || !Array.isArray(payload.labels)) return null

  const labels = payload.labels.filter((label): label is FlowDeskGmailLabelName =>
    typeof label === "string" && isFlowDeskGmailLabelName(label)
  )
  return { threadId, labels: Array.from(new Set(labels)) }
}

export async function queueFlowDeskLabelWriteback(input: {
  tenantId: string
  channelId: string
  conversationId: string
  threadId: string
  labels: FlowDeskGmailLabelName[]
  reason: string
}) {
  const labels = Array.from(new Set(input.labels))

  // An empty set means "remove all FlowDesk labels". Only queue that removal
  // for threads we have labeled (or tried to label) before — a prior
  // apply_labels queue row is the cheap proxy — so we don't spam Gmail with
  // removals for threads FlowDesk never touched.
  if (labels.length === 0) {
    const prior = await prisma.gmailWritebackQueue.findUnique({
      where: {
        conversationId_action: {
          conversationId: input.conversationId,
          action: "apply_labels",
        },
      },
      select: { id: true },
    })
    if (!prior) return null
  }

  const payload = {
    threadId: input.threadId,
    labels,
    reason: input.reason,
  }

  const job = await prisma.gmailWritebackQueue.upsert({
    where: {
      conversationId_action: {
        conversationId: input.conversationId,
        action: "apply_labels",
      },
    },
    create: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      action: "apply_labels",
      providerMessageIdsJson: payload,
      attempts: 0,
      lastError: null,
      status: "pending",
      nextAttemptAt: new Date(),
    },
    update: {
      providerMessageIdsJson: payload,
      lastError: null,
      status: "pending",
      nextAttemptAt: new Date(),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "gmail.labels.queued",
      payloadJson: {
        conversationId: input.conversationId,
        channelId: input.channelId,
        threadId: input.threadId,
        labels,
        reason: input.reason,
      },
    },
  })

  return job
}

export function flowDeskLabelPrefix() {
  return LABEL_PREFIX
}

/**
 * Removes any labels the tenant has explicitly disabled via GmailLabelMapping.
 * Absence of a mapping row means the label is enabled (the default), so a tenant
 * that has never customized anything keeps the full canonical set.
 */
export async function filterEnabledFlowDeskLabels(
  tenantId: string,
  labels: FlowDeskGmailLabelName[]
): Promise<FlowDeskGmailLabelName[]> {
  if (labels.length === 0) return labels

  const mappings = await prisma.gmailLabelMapping.findMany({
    where: { tenantId, canonical: { in: labels as string[] } },
    select: { canonical: true, enabled: true },
  })
  const disabled = new Set(
    mappings.filter((m) => !m.enabled).map((m) => m.canonical)
  )

  return labels.filter((label) => !disabled.has(label))
}

/**
 * Computes the FlowDesk Gmail labels for a conversation's current state and
 * queues them for writeback. This is the automatic projection path invoked after
 * classification / work-item sync — the counterpart to the manual status routes.
 *
 * No-ops (returns null) for non-Google channels and conversations without a
 * Gmail thread id. An empty computed label set is projected as a removal of all
 * FlowDesk labels — but only for threads that were labeled before (see
 * queueFlowDeskLabelWriteback).
 */
export async function projectFlowDeskLabelsForConversation(input: {
  tenantId: string
  conversationId: string
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      label: true,
      status: true,
      channel: { select: { provider: true } },
      draft: { select: { status: true } },
      stateRecord: { select: { attentionCategory: true, emailType: true } },
    },
  })

  if (!conversation) return null
  if (conversation.channel?.provider !== "google") return null
  if (!conversation.externalThreadId) return null

  const workflowStatus = deriveWorkflowStatus({
    status: conversation.status,
    draftStatus: conversation.draft?.status,
    attentionCategory: conversation.stateRecord?.attentionCategory,
    emailType: conversation.stateRecord?.emailType,
  })

  const labels = flowDeskLabelsForConversationState({
    workflowStatus,
    localLabel: conversation.label,
    draftStatus: conversation.draft?.status,
    attentionCategory: conversation.stateRecord?.attentionCategory,
  })

  const enabledLabels = await filterEnabledFlowDeskLabels(input.tenantId, labels)

  return queueFlowDeskLabelWriteback({
    tenantId: input.tenantId,
    channelId: conversation.channelId,
    conversationId: conversation.id,
    threadId: conversation.externalThreadId,
    labels: enabledLabels,
    reason: `classification.${workflowStatus}`,
  })
}
