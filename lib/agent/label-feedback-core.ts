import { prisma } from "@/lib/prisma"
import { labelToState } from "@/lib/conversation-labels"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import { isFlowDeskLabelName, type FlowDeskLabelName } from "@/lib/email-labels"

// Provider-neutral core of mailbox-label feedback learning. A user's manual
// edit to a thread's FlowDesk labels (Gmail) or categories (Outlook) funnels
// through here and is learned as a durable per-conversation state override.
//
// Providers differ ONLY in the audit-log action they record (`input.auditAction`,
// e.g. "gmail.labels.corrected" vs "outlook.labels.corrected"). The
// userStateSource / ConversationState.source literal deliberately stays
// "gmail_label" for every provider: app/home/page.tsx filters
// `source: { notIn: ["user_override", "gmail_label"] }` to exclude label-driven
// resolutions from its "resolved today" metric, so Outlook corrections must be
// excluded identically. Parameterizing the source would silently diverge that
// metric, so it is not exposed as a parameter.
//
// The `gmailLabelOverride` metadata key is intentionally shared across providers
// (both Gmail and Outlook read/write it). The name is historical, not
// Gmail-specific.

type LabelOverride = {
  workflow: FlowDeskLabelName | null
  contentType: FlowDeskLabelName | null
  updatedAt: string
}

const WORKFLOW_LABELS = new Set<FlowDeskLabelName>([
  "Needs Reply", "Needs Action", "Waiting On", "Read Later", "Handled", "Autodrafted",
])
const CONTENT_LABELS = new Set<FlowDeskLabelName>([
  "Newsletter", "Marketing", "Notification", "Calendar",
])

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function overrideFromMetadata(metadata: Record<string, unknown>): LabelOverride {
  const current = metadataRecord(metadata.gmailLabelOverride)
  return {
    workflow: isFlowDeskLabelName(current.workflow as string) && WORKFLOW_LABELS.has(current.workflow as FlowDeskLabelName)
      ? current.workflow as FlowDeskLabelName : null,
    contentType: isFlowDeskLabelName(current.contentType as string) && CONTENT_LABELS.has(current.contentType as FlowDeskLabelName)
      ? current.contentType as FlowDeskLabelName : null,
    updatedAt: typeof current.updatedAt === "string" ? current.updatedAt : "",
  }
}

function ownWritebackMatches(payload: unknown, added: FlowDeskLabelName[], removed: FlowDeskLabelName[]) {
  const value = metadataRecord(payload)
  if (!Array.isArray(value.labels)) return false
  const desired = new Set(value.labels.filter(isFlowDeskLabelName))
  return added.every((label) => desired.has(label)) && removed.every((label) => !desired.has(label))
}

export async function applyLabelFeedbackCore(input: {
  tenantId: string
  conversationId: string
  added: string[]
  removed: string[]
  auditAction: string
}): Promise<{ applied: boolean; kind: "addition" | "removal" | "ignored" }> {
  const added = input.added.filter(isFlowDeskLabelName)
  const removed = input.removed.filter(isFlowDeskLabelName)
  if (added.length === 0 && removed.length === 0) return { applied: false, kind: "ignored" }

  const latestWriteback = await prisma.emailWritebackQueue.findUnique({
    where: { conversationId_action: { conversationId: input.conversationId, action: "apply_labels" } },
    select: { id: true, status: true, providerMessageIdsJson: true },
  })
  if (latestWriteback?.status === "completed" && ownWritebackMatches(latestWriteback.providerMessageIdsJson, added, removed)) {
    // A completed label job can remain in the queue indefinitely. Atomically
    // consume its one expected history echo so a later identical user edit is
    // still learned as feedback.
    const consumed = await prisma.emailWritebackQueue.updateMany({
      where: { id: latestWriteback.id, status: "completed" },
      data: { status: "acknowledged" },
    })
    if (consumed.count > 0) return { applied: false, kind: "ignored" }
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    select: {
      id: true, status: true, userState: true,
      draft: { select: { status: true } },
      stateRecord: {
        select: {
          state: true, priority: true, reason: true, nextAction: true, confidence: true,
          attentionCategory: true, emailType: true, metadataJson: true,
        },
      },
    },
  })
  if (!conversation) return { applied: false, kind: "ignored" }

  const metadata = metadataRecord(conversation.stateRecord?.metadataJson)
  const override = overrideFromMetadata(metadata)
  const workflowAddition = added.find((label) => WORKFLOW_LABELS.has(label))
  const contentAddition = added.find((label) => CONTENT_LABELS.has(label))
  const workflowRemoval = removed.some((label) => WORKFLOW_LABELS.has(label))
  const contentRemoval = removed.some((label) => CONTENT_LABELS.has(label))
  const kind = added.length > 0 ? "addition" as const : "removal" as const
  const now = new Date()

  if (workflowAddition) override.workflow = workflowAddition
  else if (workflowRemoval) override.workflow = null
  if (contentAddition) override.contentType = contentAddition
  else if (contentRemoval) override.contentType = null
  override.updatedAt = now.toISOString()

  const primaryLabel = workflowAddition ?? contentAddition
  const resolved = primaryLabel
    ? labelToState(primaryLabel, {
        currentStatus: conversation.status,
        currentAttentionCategory: conversation.stateRecord?.attentionCategory ?? null,
        draftStatus: conversation.draft?.status ?? null,
      })
    : null
  if (resolved && "rejected" in resolved) return { applied: false, kind: "ignored" }

  const stateUpdate = resolved && !("rejected" in resolved) ? resolved : null
  const attentionCategory = stateUpdate?.attentionCategory ?? (contentRemoval ? null : conversation.stateRecord?.attentionCategory ?? null)
  const emailType = stateUpdate?.emailType ?? (contentRemoval ? null : conversation.stateRecord?.emailType ?? null)
  const metadataJson = {
    ...metadata,
    attentionCategory,
    emailType,
    gmailLabelOverride: override,
    updatedAt: now.toISOString(),
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: stateUpdate
      ? {
          status: stateUpdate.status,
          userState: stateUpdate.userState,
          userStateSource: "gmail_label",
          userStateUpdatedAt: now,
          ...(stateUpdate.status === "closed" ? { readAt: now, gmailUnread: false } : {}),
        }
      : workflowRemoval
        ? { userState: null, userStateSource: "gmail_label", userStateUpdatedAt: now }
        : {},
  })

  await prisma.conversationState.upsert({
    where: { conversationId: conversation.id },
    create: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      state: stateUpdate?.state ?? conversation.stateRecord?.state ?? "needs_reply",
      priority: stateUpdate?.priority ?? conversation.stateRecord?.priority ?? "medium",
      reason: stateUpdate?.reason ?? conversation.stateRecord?.reason ?? "Gmail label removed by user.",
      nextAction: stateUpdate?.nextAction ?? conversation.stateRecord?.nextAction ?? "Review this conversation.",
      confidence: 1,
      source: "gmail_label",
      metadataJson,
      ...conversationStateMetadataData(metadataJson),
    },
    update: {
      ...(stateUpdate ? {
        state: stateUpdate.state, priority: stateUpdate.priority, reason: stateUpdate.reason,
        nextAction: stateUpdate.nextAction,
      } : {}),
      confidence: 1,
      source: "gmail_label",
      metadataJson,
      ...conversationStateMetadataData(metadataJson),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: input.auditAction,
      payloadJson: { conversationId: conversation.id, added, removed, gmailLabelOverride: override },
    },
  })

  if (stateUpdate) {
    const sender = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: "inbound" },
      orderBy: { createdAt: "asc" },
      select: { fromE164: true },
    })
    const fromEmail = sender?.fromE164?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
    const fromDomain = fromEmail?.split("@")[1]
    if (fromEmail && fromDomain) {
      await prisma.classificationCorrection.create({
        data: {
          tenantId: input.tenantId, conversationId: conversation.id, fromEmail, fromDomain,
          previousAttention: conversation.stateRecord?.attentionCategory ?? null,
          newAttention: stateUpdate.attentionCategory,
        },
      })
    }
  }

  return { applied: true, kind }
}
