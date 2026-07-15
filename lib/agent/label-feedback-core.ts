import { prisma } from "@/lib/prisma"
import { labelToState } from "@/lib/conversation-labels"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import {
  FLOWDESK_LABEL_ECHO_WINDOW_MS,
  flowDeskLabelWritebackHistory,
  isFlowDeskLabelName,
  type FlowDeskLabelName,
} from "@/lib/email-labels"

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

// Applying a desired set D adds D's labels and removes every FlowDesk label
// outside D — so a mailbox change is consistent with our own application of D
// iff added ⊆ D and removed ∩ D = ∅.
function matchesDesiredLabelSet(desired: Iterable<FlowDeskLabelName>, added: FlowDeskLabelName[], removed: FlowDeskLabelName[]) {
  const set = new Set(desired)
  return added.every((label) => set.has(label)) && removed.every((label) => !set.has(label))
}

function ownWritebackMatches(payload: unknown, added: FlowDeskLabelName[], removed: FlowDeskLabelName[]) {
  const value = metadataRecord(payload)
  if (!Array.isArray(value.labels)) return false
  return matchesDesiredLabelSet(value.labels.filter(isFlowDeskLabelName), added, removed)
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
    select: { id: true, status: true, providerMessageIdsJson: true, updatedAt: true },
  })
  if (latestWriteback) {
    const matchesLatest = ownWritebackMatches(latestWriteback.providerMessageIdsJson, added, removed)
    if (latestWriteback.status === "completed" && matchesLatest) {
      // A completed label job can remain in the queue indefinitely. Atomically
      // consume its one expected history echo so a later identical user edit is
      // still learned as feedback.
      const consumed = await prisma.emailWritebackQueue.updateMany({
        where: { id: latestWriteback.id, status: "completed" },
        data: { status: "acknowledged" },
      })
      if (consumed.count > 0) return { applied: false, kind: "ignored" }
    }
    // A second echo of an already-consumed application (inline drain + cron
    // both applied, or the provider delivered the history record twice) must
    // not be learned as a user edit — but only inside the echo window, so a
    // genuine identical re-edit later still counts as feedback.
    if (
      latestWriteback.status === "acknowledged" &&
      matchesLatest &&
      Date.now() - latestWriteback.updatedAt.getTime() < FLOWDESK_LABEL_ECHO_WINDOW_MS
    ) {
      return { applied: false, kind: "ignored" }
    }
    // Echoes of applications this queue row has since superseded (see
    // FlowDeskLabelApplication in lib/email-labels.ts): rapid back-to-back
    // projections replace the payload before the first application's echo
    // arrives, so match against the recorded recent sets too. Misreading one
    // of these as a user edit is what locked conversations under a bogus
    // gmailLabelOverride.
    const now = Date.now()
    for (const application of flowDeskLabelWritebackHistory(latestWriteback.providerMessageIdsJson)) {
      const appliedAt = Date.parse(application.at)
      if (!Number.isFinite(appliedAt) || now - appliedAt >= FLOWDESK_LABEL_ECHO_WINDOW_MS) continue
      if (matchesDesiredLabelSet(application.labels, added, removed)) {
        return { applied: false, kind: "ignored" }
      }
    }
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

  // A removal with no replacement label previously only recorded the override
  // and left attention/status untouched — so stripping "Needs Reply" in the
  // mailbox kept the conversation deriving needs_reply in the app forever,
  // while the override simultaneously stopped us re-adding the label in the
  // mailbox. Resolve the intent instead: removing an active workflow label
  // means "done with this" (Handled semantics); removing Handled re-opens the
  // conversation to re-derive from signals. Autodrafted projects from the
  // draft's own status, so its removal alone changes no conversation state.
  type RemovalResolution = {
    status: "needs_reply" | "in_progress" | "closed"
    userState: string | null
    attentionCategory: string | null
    state: string
    priority: string
    reason: string
    nextAction: string
  }
  let removalResolution: RemovalResolution | null = null
  if (!stateUpdate && workflowRemoval) {
    const removedWorkflow = removed.filter((label) => WORKFLOW_LABELS.has(label) && label !== "Autodrafted")
    if (removedWorkflow.includes("Handled")) {
      removalResolution = {
        status: "needs_reply",
        userState: null,
        attentionCategory: null,
        state: "needs_reply",
        priority: "medium",
        reason: "User removed the Handled label in their mailbox; re-opening the conversation.",
        nextAction: "Review this conversation.",
      }
    } else if (removedWorkflow.length > 0) {
      const handled = labelToState("Handled", {
        currentStatus: conversation.status,
        currentAttentionCategory: conversation.stateRecord?.attentionCategory ?? null,
        draftStatus: conversation.draft?.status ?? null,
      })
      if (!("rejected" in handled)) {
        removalResolution = {
          status: handled.status,
          userState: handled.userState,
          attentionCategory: handled.attentionCategory,
          state: handled.state,
          priority: handled.priority,
          reason: `User removed the ${removedWorkflow.join(", ")} label in their mailbox; treating the conversation as handled.`,
          nextAction: handled.nextAction,
        }
      }
    }
  }

  const attentionCategory = stateUpdate
    ? stateUpdate.attentionCategory
    : removalResolution
      ? removalResolution.attentionCategory
      : contentRemoval
        ? null
        : conversation.stateRecord?.attentionCategory ?? null
  const emailType = stateUpdate?.emailType ?? (contentRemoval ? null : conversation.stateRecord?.emailType ?? null)
  const metadataJson = {
    ...metadata,
    attentionCategory,
    emailType,
    gmailLabelOverride: override,
    updatedAt: now.toISOString(),
  }

  const conversationUpdate = stateUpdate ?? removalResolution
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: conversationUpdate
      ? {
          status: conversationUpdate.status,
          userState: conversationUpdate.userState,
          userStateSource: "gmail_label",
          userStateUpdatedAt: now,
          ...(conversationUpdate.status === "closed" ? { readAt: now, gmailUnread: false } : {}),
        }
      : workflowRemoval
        ? { userState: null, userStateSource: "gmail_label", userStateUpdatedAt: now }
        : {},
  })

  const stateFields = stateUpdate ?? removalResolution
  await prisma.conversationState.upsert({
    where: { conversationId: conversation.id },
    create: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      state: stateFields?.state ?? conversation.stateRecord?.state ?? "needs_reply",
      priority: stateFields?.priority ?? conversation.stateRecord?.priority ?? "medium",
      reason: stateFields?.reason ?? conversation.stateRecord?.reason ?? "Gmail label removed by user.",
      nextAction: stateFields?.nextAction ?? conversation.stateRecord?.nextAction ?? "Review this conversation.",
      confidence: 1,
      source: "gmail_label",
      metadataJson,
      ...conversationStateMetadataData(metadataJson),
    },
    update: {
      ...(stateFields ? {
        state: stateFields.state, priority: stateFields.priority, reason: stateFields.reason,
        nextAction: stateFields.nextAction,
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

  const correctionAttention = stateUpdate?.attentionCategory ?? removalResolution?.attentionCategory ?? null
  if (correctionAttention) {
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
          newAttention: correctionAttention,
        },
      })
    }
  }

  return { applied: true, kind }
}
