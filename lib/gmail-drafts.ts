import { prisma } from "@/lib/prisma"

export const GMAIL_DRAFT_CREATE_ACTION = "create_draft"
export const GMAIL_DRAFT_WITHDRAW_ACTION = "withdraw_draft"

/**
 * Reads the stored Gmail draft id off a Draft's metadata, if one exists.
 * FlowDesk records the id it gets back from users.drafts.create so it can update
 * or withdraw the same draft later instead of creating duplicates.
 */
export function gmailDraftIdFromMetadata(metadataJson: unknown): string | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
    return null
  }
  const value = (metadataJson as Record<string, unknown>).gmailDraftId
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Queues creation of a Gmail-native draft for a conversation. Idempotent via the
 * (conversationId, action) unique key — re-queuing just refreshes the job. Any
 * pending withdrawal for the same conversation is dropped, since we now want a
 * draft to exist.
 */
export async function queueGmailDraftWriteback(input: {
  tenantId: string
  channelId: string
  conversationId: string
  threadId: string
}) {
  await prisma.gmailWritebackQueue.deleteMany({
    where: { conversationId: input.conversationId, action: GMAIL_DRAFT_WITHDRAW_ACTION },
  })

  const payload = { threadId: input.threadId }

  const job = await prisma.gmailWritebackQueue.upsert({
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
  await prisma.gmailWritebackQueue.deleteMany({
    where: { conversationId: input.conversationId, action: GMAIL_DRAFT_CREATE_ACTION },
  })

  const job = await prisma.gmailWritebackQueue.upsert({
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
