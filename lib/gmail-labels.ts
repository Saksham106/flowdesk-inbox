import { prisma } from "@/lib/prisma"
import type { WorkflowStatus } from "@/lib/workflow-status"

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

export function normalizeFlowDeskLabelPayload(value: unknown): {
  threadId: string
  labels: FlowDeskGmailLabelName[]
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const threadId = typeof payload.threadId === "string" ? payload.threadId : ""
  const labels = Array.isArray(payload.labels)
    ? payload.labels.filter((label): label is FlowDeskGmailLabelName =>
        typeof label === "string" && isFlowDeskGmailLabelName(label)
      )
    : []

  if (!threadId || labels.length === 0) return null
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
  if (labels.length === 0) return null

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
