import { prisma } from "@/lib/prisma"
import { getAutomationLevel, isActionAllowedAtLevel } from "@/lib/agent/automation-level"

export const GMAIL_DRAFT_CREATE_ACTION = "create_draft"
export const GMAIL_DRAFT_WITHDRAW_ACTION = "withdraw_draft"

export type InboundDraftSource = {
  providerMessageId: string
  createdAt: Date
}

/** Neutral draft-id accessor: new writes use providerDraftId; legacy Gmail rows used gmailDraftId. */
export function providerDraftIdFromMetadata(metadataJson: unknown): string | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return null
  const record = metadataJson as Record<string, unknown>
  const value = record.providerDraftId ?? record.gmailDraftId
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Reads the stored provider draft id off a Draft's metadata, if one exists.
 * FlowDesk records the id it gets back from the provider so it can update
 * or withdraw the same draft later instead of creating duplicates. Retained for
 * existing UI/tests; delegates to the neutral accessor.
 */
export function gmailDraftIdFromMetadata(metadataJson: unknown): string | null {
  return providerDraftIdFromMetadata(metadataJson)
}

/**
 * Finds the newest inbound message that contains authored content. Empty Gmail
 * transport stubs and label-only sync artifacts must not invalidate a draft.
 */
export function latestMeaningfulInboundMessage<T extends {
  direction: string
  providerMessageId: string
  createdAt: Date
  body: string
}>(messages: T[]): InboundDraftSource | null {
  return messages.reduce<InboundDraftSource | null>((latest, message) => {
    if (message.direction !== "inbound" || typeof message.body !== "string" || !message.body.trim()) {
      return latest
    }
    if (!latest || message.createdAt > latest.createdAt) {
      return { providerMessageId: message.providerMessageId, createdAt: message.createdAt }
    }
    return latest
  }, null)
}

export function draftSourceFromMetadata(metadataJson: unknown): InboundDraftSource | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return null

  const metadata = metadataJson as Record<string, unknown>
  const providerMessageId = metadata.sourceInboundMessageId
  const sourceInboundAt = metadata.sourceInboundAt
  if (typeof providerMessageId !== "string" || !providerMessageId || typeof sourceInboundAt !== "string") {
    return null
  }

  const createdAt = new Date(sourceInboundAt)
  return Number.isNaN(createdAt.getTime()) ? null : { providerMessageId, createdAt }
}

/**
 * Queues creation of a Gmail-native draft for a conversation. Idempotent via the
 * (conversationId, action) unique key — re-queuing just refreshes the job. Any
 * pending withdrawal for the same conversation is dropped, since we now want a
 * draft to exist.
 *
 * No-ops below automation Level 3: the draft still exists in the dashboard,
 * but FlowDesk does not write into the user's Gmail drafts folder. Withdrawal
 * (queueGmailDraftWithdrawal) is deliberately NOT level-gated — cleanup must
 * keep working after a tenant lowers their level.
 */
export async function queueGmailDraftWriteback(input: {
  tenantId: string
  channelId: string
  conversationId: string
  threadId: string
}) {
  const automationLevel = await getAutomationLevel(input.tenantId)
  if (!isActionAllowedAtLevel(automationLevel, "create_gmail_drafts")) return null

  await prisma.emailWritebackQueue.deleteMany({
    where: { conversationId: input.conversationId, action: GMAIL_DRAFT_WITHDRAW_ACTION },
  })

  const payload = { threadId: input.threadId }

  const job = await prisma.emailWritebackQueue.upsert({
    where: {
      conversationId_action: {
        conversationId: input.conversationId,
        action: GMAIL_DRAFT_CREATE_ACTION,
      },
    },
    create: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      action: GMAIL_DRAFT_CREATE_ACTION,
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
      action: "gmail.draft.queued",
      payloadJson: {
        conversationId: input.conversationId,
        channelId: input.channelId,
        threadId: input.threadId,
      },
    },
  })

  return job
}

/**
 * Queues withdrawal (deletion) of any Gmail-native draft for a conversation —
 * used when the draft is cleared or the user has replied manually. Drops any
 * pending create job so we don't recreate a draft we're trying to remove.
 */
export async function queueGmailDraftWithdrawal(input: {
  tenantId: string
  channelId: string
  conversationId: string
}) {
  await prisma.emailWritebackQueue.deleteMany({
    where: { conversationId: input.conversationId, action: GMAIL_DRAFT_CREATE_ACTION },
  })

  const job = await prisma.emailWritebackQueue.upsert({
    where: {
      conversationId_action: {
        conversationId: input.conversationId,
        action: GMAIL_DRAFT_WITHDRAW_ACTION,
      },
    },
    create: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      action: GMAIL_DRAFT_WITHDRAW_ACTION,
      providerMessageIdsJson: {},
      attempts: 0,
      lastError: null,
      status: "pending",
      nextAttemptAt: new Date(),
    },
    update: {
      attempts: 0,
      lastError: null,
      status: "pending",
      nextAttemptAt: new Date(),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "gmail.draft.withdraw_queued",
      payloadJson: {
        conversationId: input.conversationId,
        channelId: input.channelId,
      },
    },
  })

  return job
}
