import { prisma } from "@/lib/prisma"
import { deriveWorkflowStatus, type WorkflowStatus } from "@/lib/workflow-status"
import { getAutomationLevel, isActionAllowedAtLevel } from "@/lib/agent/automation-level"
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { hasGmailLabelOverride } from "@/lib/agent/gmail-label-override"

// Labels are flat, top-level Gmail labels named exactly for what they mean
// ("Needs Reply", "Waiting On", …) with no "FlowDesk/" namespace prefix.
//
// "Handle First" was removed from this vocabulary: no classifier, rule, or
// correction can produce a "handle_first" attention category (the dashboard's
// Handle First section is a relative ranking computed per request by the command
// center, not a persisted per-conversation state), so the label could never be
// applied. It is never created or applied anymore.
//
// Vocabulary redesigned to take inspiration from Inbox Zero's content-type
// taxonomy (Newsletter/Marketing/Notification/Calendar) alongside the existing
// workflow-state labels. Retired: "Follow Up" (overdue tracking stays app-side
// only, see followUpDueAt/WaitingOnSection — it no longer produces a distinct
// Gmail label), "Important" (the underlying Lead/Pricing/Complaint signal is
// in-app only now), "Low Priority" (superseded by the more specific content
// labels below).
export const FLOWDESK_GMAIL_LABEL_NAMES = [
  "Needs Reply",
  "Needs Action",
  "Waiting On",
  "Read Later",
  "Handled",
  "Autodrafted",
  "Newsletter",
  "Marketing",
  "Notification",
  "Calendar",
] as const

export type FlowDeskGmailLabelName = (typeof FLOWDESK_GMAIL_LABEL_NAMES)[number]

const FLOWDESK_GMAIL_LABEL_SET = new Set<string>(FLOWDESK_GMAIL_LABEL_NAMES)

// The labels were previously created under a "FlowDesk/" namespace. Accounts
// connected before the flattening still have those nested labels in Gmail, so
// the ensure/apply paths rename them in place (see reconcileLegacyFlowDeskLabels
// in lib/google.ts) — old name → new flat name — preserving each label's Gmail
// id and thread associations. Kept as an explicit map so a future vocabulary
// change can't silently drop a legacy label from migration.
export const LEGACY_FLOWDESK_LABEL_PREFIX = "FlowDesk/"

export const LEGACY_FLOWDESK_LABEL_RENAMES: ReadonlyArray<
  readonly [legacyName: string, newName: FlowDeskGmailLabelName]
> = FLOWDESK_GMAIL_LABEL_NAMES.map(
  (name) => [`${LEGACY_FLOWDESK_LABEL_PREFIX}${name}`, name] as const
)

const NEEDS_ACTION_ATTENTION = new Set(["needs_action"])

// Maps a deterministic classifier emailType to the content-type label it
// projects, if any. "needs_reply" carries no content label of its own; "fyi"
// (informational-but-no-clear-category) folds into "Notification" alongside
// the classifier's own "notification" type, mirroring how Inbox Zero treats
// receipts/automated mail as one bucket rather than a separate label.
const EMAIL_TYPE_CONTENT_LABEL: Partial<Record<string, FlowDeskGmailLabelName>> = {
  newsletter: "Newsletter",
  marketing: "Marketing",
  notification: "Notification",
  fyi: "Notification",
  calendar: "Calendar",
}

export function isFlowDeskGmailLabelName(label: string): label is FlowDeskGmailLabelName {
  return FLOWDESK_GMAIL_LABEL_SET.has(label)
}

// Neutral aliases: the taxonomy applies to any mailbox provider (Gmail labels,
// Outlook categories). New code should use these; the Gmail-suffixed names
// remain for existing imports.
export const FLOWDESK_LABEL_NAMES = FLOWDESK_GMAIL_LABEL_NAMES
export type FlowDeskLabelName = FlowDeskGmailLabelName
export const isFlowDeskLabelName = isFlowDeskGmailLabelName

export function flowDeskLabelsForConversationState(input: {
  workflowStatus: WorkflowStatus
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}): FlowDeskGmailLabelName[] {
  const labels: FlowDeskGmailLabelName[] = []

  switch (input.workflowStatus) {
    case "needs_reply":
      labels.push("Needs Reply")
      break
    case "draft_ready":
      labels.push("Needs Reply", "Autodrafted")
      break
    case "waiting_on":
      labels.push("Waiting On")
      break
    case "read_later":
      labels.push("Read Later")
      break
    case "done":
      labels.push("Handled")
      break
  }

  if (NEEDS_ACTION_ATTENTION.has(input.attentionCategory ?? "")) {
    labels.push("Needs Action")
  }
  if (input.draftStatus === "proposed" || input.draftStatus === "approved") {
    labels.push("Autodrafted")
  }
  const contentLabel = EMAIL_TYPE_CONTENT_LABEL[input.emailType ?? ""]
  if (contentLabel) {
    labels.push(contentLabel)
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
    const prior = await prisma.emailWritebackQueue.findUnique({
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

  const job = await prisma.emailWritebackQueue.upsert({
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
      attempts: 0,
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

  // Best-effort inline drain: apply this job to Gmail right away instead of
  // waiting for the next gmail-writeback cron tick. This is what makes label
  // changes actually show up in Gmail promptly rather than depending entirely
  // on a cron being scheduled — the cron remains the reliability backstop for
  // whatever this inline attempt can't finish (Gmail hiccup, etc). Dynamic
  // import avoids a static circular dependency: the processor depends on
  // lib/google.ts, which itself depends on this file for label constants.
  const { processEmailWritebackJobById } = await import("@/lib/agent/email-writeback-processor")
  await processEmailWritebackJobById(job.id).catch((err) => {
    console.error("[gmail-labels] inline writeback drain failed, will retry via cron:", err)
  })

  return job
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
 * No-ops (returns null) when the tenant's automation level is below 2 (labels
 * are the first rung of the trust ladder that touches Gmail), for non-Google
 * channels, and for conversations without a Gmail thread id. An empty computed
 * label set — including when the tenant has disabled every applicable label — is
 * projected as a removal of all FlowDesk labels, but only for threads that were
 * labeled before (see queueFlowDeskLabelWriteback).
 */
export async function projectFlowDeskLabelsForConversation(input: {
  tenantId: string
  conversationId: string
}) {
  const automationLevel = await getAutomationLevel(input.tenantId)
  if (!isActionAllowedAtLevel(automationLevel, "apply_gmail_labels")) return null

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      status: true,
      userState: true,
      lastMessageAt: true,
      channel: { select: { provider: true } },
      draft: { select: { status: true } },
      stateRecord: { select: { attentionCategory: true, emailType: true, metadataJson: true } },
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { fromE164: true, subject: true, body: true },
      },
    },
  })

  if (!conversation) return null
  if (conversation.channel?.provider !== "google") return null
  if (!conversation.externalThreadId) return null
  if (hasGmailLabelOverride(conversation.stateRecord?.metadataJson)) return null

  // The AI classification job populates ConversationState.attentionCategory /
  // emailType, but for a conversation it has never run for (e.g. the job
  // pipeline wasn't wired up yet when the account connected), both are null —
  // and deriveWorkflowStatus falls all the way through to "needs_reply" for
  // everything, even obvious newsletters/notifications. Fall back to the
  // deterministic (no AI, no DB) classifier used elsewhere in the pipeline so
  // an unclassified conversation still gets a reasonable label instead of a
  // uniform, wrong "Needs Reply".
  let attentionCategory = conversation.stateRecord?.attentionCategory ?? null
  let emailType = conversation.stateRecord?.emailType ?? null
  const firstInbound = conversation.messages[0]
  if (!attentionCategory && !emailType && firstInbound) {
    const fallback = classifyEmailType({
      fromEmail: firstInbound.fromE164,
      subject: firstInbound.subject ?? "",
      body: firstInbound.body,
    })
    attentionCategory = fallback.attentionCategory
    emailType = fallback.emailType
  }

  const workflowStatus = deriveWorkflowStatus({
    status: conversation.status,
    userState: conversation.userState,
    draftStatus: conversation.draft?.status,
    attentionCategory,
    emailType,
  })

  const labels = flowDeskLabelsForConversationState({
    workflowStatus,
    draftStatus: conversation.draft?.status,
    attentionCategory,
    emailType,
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
