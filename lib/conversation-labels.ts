import { prisma } from "@/lib/prisma"
import { extractEmail } from "@/lib/google"
import { extractDomainFromEmail } from "@/lib/agent/preference-learning"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import {
  flowDeskLabelsForConversationState,
  queueFlowDeskLabelWriteback,
  type FlowDeskGmailLabelName,
} from "@/lib/gmail-labels"
import { revalidateInboxViews } from "@/lib/cache-tags"

type ConversationStatus = "needs_reply" | "in_progress" | "closed"

// The full derived-state shape a manual label selection resolves to. This is
// the single source of truth for "what does picking this canonical label
// actually do to the conversation" — every field the /flowdesk-label route
// writes comes from here, so the mapping stays auditable in one place instead
// of scattered across the route handler.
export type ConversationLabelStateUpdate = {
  status: ConversationStatus
  userState: string
  attentionCategory: string
  emailType: string | null
  state: string
  priority: string
  reason: string
  nextAction: string
}

export type ConversationLabelContext = {
  currentStatus: string
  currentAttentionCategory: string | null
  draftStatus: string | null
}

type StaticLabelMapping = Omit<ConversationLabelStateUpdate, "emailType"> & { emailType?: string }

// Static, context-free mappings for the eight labels whose resulting state
// doesn't depend on the conversation's current state. "Calendar" and
// "Autodrafted" are handled separately below because their resolution
// genuinely depends on context (existing attention category / draft status) —
// see labelToState.
const STATIC_LABEL_STATE: Record<
  Exclude<FlowDeskGmailLabelName, "Calendar" | "Autodrafted">,
  StaticLabelMapping
> = {
  "Needs Reply": {
    status: "needs_reply",
    userState: "needs_reply",
    attentionCategory: "needs_reply",
    state: "needs_reply",
    priority: "high",
    reason: "User manually labeled this conversation as needing a reply.",
    nextAction: "Draft a reply.",
  },
  "Needs Action": {
    status: "needs_reply",
    userState: "needs_action",
    attentionCategory: "needs_action",
    state: "waiting_on_you",
    priority: "high",
    reason: "User manually labeled this conversation as needing action.",
    nextAction: "Complete the requested action.",
  },
  "Waiting On": {
    status: "in_progress",
    userState: "waiting_on",
    attentionCategory: "waiting_on",
    state: "waiting_on_them",
    priority: "medium",
    reason: "User manually labeled this conversation as waiting on someone else.",
    nextAction: "Check back later or send a follow-up.",
  },
  "Read Later": {
    status: "needs_reply",
    userState: "read_later",
    attentionCategory: "read_later",
    state: "fyi_only",
    priority: "low",
    reason: "User manually labeled this conversation to read later.",
    nextAction: "Read later if relevant.",
  },
  Handled: {
    status: "closed",
    userState: "done",
    attentionCategory: "fyi_done",
    state: "fyi_only",
    priority: "none",
    reason: "User manually labeled this conversation as handled.",
    nextAction: "No action needed.",
  },
  Newsletter: {
    status: "closed",
    userState: "quiet",
    attentionCategory: "quiet",
    emailType: "newsletter",
    state: "fyi_only",
    priority: "none",
    reason: "User manually labeled this conversation as a newsletter.",
    nextAction: "No action needed.",
  },
  Marketing: {
    status: "closed",
    userState: "quiet",
    attentionCategory: "quiet",
    emailType: "marketing",
    state: "fyi_only",
    priority: "none",
    reason: "User manually labeled this conversation as marketing.",
    nextAction: "No action needed.",
  },
  Notification: {
    status: "closed",
    userState: "fyi_done",
    attentionCategory: "fyi_done",
    emailType: "notification",
    state: "fyi_only",
    priority: "none",
    reason: "User manually labeled this conversation as a notification.",
    nextAction: "No action needed.",
  },
}

// Mirrors the attentionCategory -> userState convention used by the static
// table above, reused by the "Calendar" branch so an inherited attention
// category still lands on the userState the rest of the app expects.
const ATTENTION_TO_USER_STATE: Record<string, string> = {
  needs_reply: "needs_reply",
  needs_action: "needs_action",
  waiting_on: "waiting_on",
  read_later: "read_later",
  fyi_done: "done",
  quiet: "quiet",
}

export type LabelRejection = { rejected: true; error: string }

/**
 * Resolves a canonical FlowDesk label + the conversation's current context
 * into the full state update to apply. Returns a rejection object (instead of
 * throwing) when the label can't be applied manually — currently only
 * "Autodrafted", which must never be used to fabricate a draft that doesn't
 * exist.
 */
export function labelToState(
  label: FlowDeskGmailLabelName,
  context: ConversationLabelContext
): ConversationLabelStateUpdate | LabelRejection {
  if (label === "Autodrafted") {
    if (context.draftStatus !== "proposed" && context.draftStatus !== "approved") {
      return {
        rejected: true,
        error:
          "Autodrafted can only be applied when a draft is already proposed or approved; it cannot be selected manually to create one.",
      }
    }
    // The draft already carries "proposed"/"approved" status, which is what
    // flowDeskLabelsForConversationState uses to project the "Autodrafted"
    // Gmail label — the conversation itself just needs to read as needing a
    // reply (draft_ready is derived, not stored).
    return {
      status: "needs_reply",
      userState: "needs_reply",
      attentionCategory: "needs_reply",
      emailType: null,
      state: "needs_reply",
      priority: "high",
      reason: "User confirmed the AI-drafted reply is ready to review.",
      nextAction: "Review and send the drafted reply.",
    }
  }

  if (label === "Calendar") {
    const actionable = context.currentStatus === "needs_reply" || context.currentStatus === "in_progress"
    const status: ConversationStatus = actionable ? (context.currentStatus as ConversationStatus) : "needs_reply"
    const attentionCategory = context.currentAttentionCategory ?? "needs_action"
    return {
      status,
      userState: ATTENTION_TO_USER_STATE[attentionCategory] ?? attentionCategory,
      attentionCategory,
      emailType: "calendar",
      state: "needs_reply",
      priority: "medium",
      reason: "User manually labeled this conversation as calendar-related.",
      nextAction: "Review the calendar event or scheduling request.",
    }
  }

  const mapping = STATIC_LABEL_STATE[label]
  return {
    status: mapping.status,
    userState: mapping.userState,
    attentionCategory: mapping.attentionCategory,
    emailType: mapping.emailType ?? null,
    state: mapping.state,
    priority: mapping.priority,
    reason: mapping.reason,
    nextAction: mapping.nextAction,
  }
}

export type SetConversationFlowDeskLabelInput = {
  tenantId: string
  userId: string
  conversationId: string
  label: FlowDeskGmailLabelName
}

export type SetConversationFlowDeskLabelResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * The single write path for a user manually changing a conversation's
 * FlowDesk label. Applies the label->state mapping from labelToState, then
 * performs every side effect a manual correction must have: updates
 * Conversation + ConversationState, preserves prior user-override metadata,
 * records an AuditLog entry, records a ClassificationCorrection (so repeated
 * corrections can graduate into a SenderRule via the existing
 * preference-learning pipeline), queues the Gmail label writeback, and
 * revalidates the cached inbox views.
 */
export async function setConversationFlowDeskLabel(
  input: SetConversationFlowDeskLabelInput
): Promise<SetConversationFlowDeskLabelResult> {
  const { tenantId, userId, conversationId, label } = input

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      status: true,
      userState: true,
      contact: { select: { phoneE164: true } },
      draft: { select: { status: true } },
      stateRecord: { select: { attentionCategory: true, emailType: true, metadataJson: true } },
      channel: { select: { provider: true } },
    },
  })
  if (!conversation) {
    return { ok: false, status: 404, error: "Not found" }
  }

  const resolved = labelToState(label, {
    currentStatus: conversation.status,
    currentAttentionCategory: conversation.stateRecord?.attentionCategory ?? null,
    draftStatus: conversation.draft?.status ?? null,
  })

  if ("rejected" in resolved) {
    return { ok: false, status: 400, error: resolved.error }
  }

  const now = new Date()
  const prevMeta =
    conversation.stateRecord?.metadataJson &&
    typeof conversation.stateRecord.metadataJson === "object" &&
    !Array.isArray(conversation.stateRecord.metadataJson)
      ? (conversation.stateRecord.metadataJson as Record<string, unknown>)
      : {}
  const previousAttention = typeof prevMeta.attentionCategory === "string" ? prevMeta.attentionCategory : null

  const metadataJson = {
    ...prevMeta,
    attentionCategory: resolved.attentionCategory,
    emailType: resolved.emailType,
    flowDeskLabel: label,
    labelCorrectedByUser: true,
    labelCorrectedAt: now.toISOString(),
    userOverride: true,
    userState: resolved.userState,
    updatedAt: now.toISOString(),
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: resolved.status,
      userState: resolved.userState,
      userStateSource: "user",
      userStateUpdatedAt: now,
      ...(resolved.status === "closed" ? { readAt: now, gmailUnread: false } : {}),
    },
  })

  await prisma.conversationState.upsert({
    where: { conversationId },
    create: {
      tenantId,
      conversationId,
      state: resolved.state,
      priority: resolved.priority,
      reason: resolved.reason,
      nextAction: resolved.nextAction,
      confidence: 1,
      source: "user_override",
      metadataJson,
      ...conversationStateMetadataData(metadataJson),
    },
    update: {
      state: resolved.state,
      priority: resolved.priority,
      reason: resolved.reason,
      nextAction: resolved.nextAction,
      confidence: 1,
      source: "user_override",
      metadataJson,
      ...conversationStateMetadataData(metadataJson),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: "conversation.label_corrected",
      payloadJson: {
        conversationId,
        label,
        previous: previousAttention,
        reason: "User manually changed the conversation's FlowDesk label",
      },
    },
  })

  // Learning: record the correction so repeated corrections for the same
  // sender/domain can graduate into a suggested SenderRule (same pipeline the
  // deterministic classifier's corrections feed). Skipped if we can't
  // determine a sender email — a correction record with no sender is useless
  // for that purpose — but every other side effect still happens.
  const fromEmail = conversation.contact?.phoneE164 ? extractEmail(conversation.contact.phoneE164) : ""
  if (fromEmail) {
    const fromDomain = extractDomainFromEmail(fromEmail)
    await prisma.classificationCorrection.create({
      data: {
        tenantId,
        conversationId,
        fromEmail,
        fromDomain,
        previousAttention,
        newAttention: resolved.attentionCategory,
      },
    })
  }

  if (conversation.channel?.provider === "google" && conversation.externalThreadId) {
    const labels = flowDeskLabelsForConversationState({
      workflowStatus:
        resolved.status === "closed"
          ? "done"
          : resolved.userState === "waiting_on"
            ? "waiting_on"
            : resolved.userState === "read_later"
              ? "read_later"
              : "needs_reply",
      draftStatus: conversation.draft?.status,
      attentionCategory: resolved.attentionCategory,
      emailType: resolved.emailType,
    })
    await queueFlowDeskLabelWriteback({
      tenantId,
      channelId: conversation.channelId,
      conversationId,
      threadId: conversation.externalThreadId,
      labels,
      reason: `manual_label.${label}`,
    })
  }

  revalidateInboxViews(tenantId, conversationId)

  return { ok: true }
}
