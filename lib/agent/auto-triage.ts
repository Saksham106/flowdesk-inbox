import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { getAutomationLevel, isActionAllowedAtLevel } from "@/lib/agent/automation-level"
import { hasGmailLabelOverride } from "@/lib/agent/gmail-label-override"
import { supportsMailboxWriteback } from "@/lib/email/provider-support"

export const ARCHIVE_THREAD_ACTION = "archive_thread"

// Content types the classifier considers automated/low-risk mail. Deliberately
// excludes "calendar" (invites often need an RSVP) and anything reply-shaped.
const LOW_RISK_EMAIL_TYPES = new Set(["newsletter", "marketing", "notification", "fyi"])

// Attention categories that indicate the conversation still needs the user,
// regardless of content type. "review_soon" covers security alerts — swept out
// of the inbox they would never be seen.
const BLOCKING_ATTENTION_CATEGORIES = new Set([
  "needs_action",
  "needs_reply",
  "waiting_on",
  "review_soon",
])

export type AutoTriageResult = {
  markedRead: boolean
  archived: boolean
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

/**
 * Level 4 of the automation trust ladder ("mark low-risk read / archive"): the
 * execution path the gate in automation-level.ts was wired for. Runs at the
 * end of a work-item sync pass, after classification and label projection have
 * settled, and sweeps low-risk mail (newsletters, marketing, notifications,
 * FYI) out of the mailbox inbox: mark read + archive, via the same writeback
 * queue every other mailbox mutation uses.
 *
 * Fails closed on every uncertainty: below Level 4, unsupported providers,
 * missing thread ids, user state/label overrides, active drafts, any outbound
 * message, or a blocking attention category all no-op. Each conversation is
 * triaged at most once (metadataJson.autoTriage marker) so a mailbox echo of
 * our own archive can never re-trigger a loop.
 */
export async function maybeAutoTriageConversation(input: {
  tenantId: string
  conversationId: string
}): Promise<AutoTriageResult | null> {
  const level = await getAutomationLevel(input.tenantId)
  const canMarkRead = isActionAllowedAtLevel(level, "auto_mark_read")
  const canArchive = isActionAllowedAtLevel(level, "auto_archive")
  if (!canMarkRead && !canArchive) return null

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      status: true,
      userState: true,
      readAt: true,
      gmailUnread: true,
      channel: { select: { provider: true } },
      draft: { select: { status: true } },
      stateRecord: { select: { attentionCategory: true, emailType: true, metadataJson: true } },
      messages: {
        select: { direction: true, providerMessageId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!conversation) return null
  const provider = conversation.channel?.provider
  if (!supportsMailboxWriteback(provider)) return null
  if (!conversation.externalThreadId) return null
  if (conversation.userState) return null
  if (hasGmailLabelOverride(conversation.stateRecord?.metadataJson)) return null

  const stateMeta = metadataObject(conversation.stateRecord?.metadataJson)
  if (stateMeta.autoTriage) return null

  const emailType = conversation.stateRecord?.emailType ?? null
  const attentionCategory = conversation.stateRecord?.attentionCategory ?? null
  if (!emailType || !LOW_RISK_EMAIL_TYPES.has(emailType)) return null
  if (attentionCategory && BLOCKING_ATTENTION_CATEGORIES.has(attentionCategory)) return null

  // An active draft or any outbound message means this is (or was) a real
  // correspondence, not automated mail — never sweep it.
  const draftStatus = conversation.draft?.status
  if (draftStatus === "proposed" || draftStatus === "approved") return null
  if (conversation.messages.some((message) => message.direction === "outbound")) return null

  const inboundProviderMessageIds = conversation.messages
    .filter((message) => message.direction === "inbound")
    .map((message) => message.providerMessageId)
  if (inboundProviderMessageIds.length === 0) return null

  const now = new Date()
  const queuedActions: string[] = []

  const markRead = canMarkRead && (conversation.gmailUnread || !conversation.readAt)
  if (markRead) {
    await prisma.emailWritebackQueue.upsert({
      where: {
        conversationId_action: { conversationId: conversation.id, action: "mark_read" },
      },
      create: {
        tenantId: input.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        action: "mark_read",
        providerMessageIdsJson: inboundProviderMessageIds,
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: now,
      },
      update: {
        providerMessageIdsJson: inboundProviderMessageIds,
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: now,
      },
    })
    queuedActions.push("mark_read")
  }

  if (canArchive) {
    await prisma.emailWritebackQueue.upsert({
      where: {
        conversationId_action: { conversationId: conversation.id, action: ARCHIVE_THREAD_ACTION },
      },
      create: {
        tenantId: input.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        action: ARCHIVE_THREAD_ACTION,
        providerMessageIdsJson: { threadId: conversation.externalThreadId },
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: now,
      },
      update: {
        providerMessageIdsJson: { threadId: conversation.externalThreadId },
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: now,
      },
    })
    queuedActions.push(ARCHIVE_THREAD_ACTION)
  }

  if (queuedActions.length === 0) return null

  // Mirror the mailbox state in-app so the two never disagree: the thread is
  // about to be read in the mailbox, and the once-only marker is what makes
  // the mailbox echo of our own mutation inert.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      gmailUnread: false,
      ...(conversation.readAt ? {} : { readAt: now }),
    },
  })

  if (conversation.stateRecord) {
    await prisma.conversationState.update({
      where: { conversationId: conversation.id },
      data: {
        metadataJson: {
          ...stateMeta,
          autoTriage: {
            at: now.toISOString(),
            actions: queuedActions,
            emailType,
            attentionCategory,
          },
        } as Prisma.InputJsonValue,
      },
    })
  }

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "automation.auto_triage",
      payloadJson: {
        conversationId: conversation.id,
        channelId: conversation.channelId,
        threadId: conversation.externalThreadId,
        actions: queuedActions,
        emailType,
        attentionCategory,
        automationLevel: level,
      } as Prisma.InputJsonValue,
    },
  })

  // Best-effort inline drain (same pattern as label writeback): the mailbox
  // mutation should land now, with the writeback cron as the retry backstop.
  const { processEmailWritebackJobById } = await import("@/lib/agent/email-writeback-processor")
  const pendingJobs = await prisma.emailWritebackQueue.findMany({
    where: {
      conversationId: conversation.id,
      action: { in: queuedActions },
      status: "pending",
    },
    select: { id: true },
  })
  for (const job of pendingJobs) {
    await processEmailWritebackJobById(job.id).catch((err) => {
      console.error("[auto-triage] inline writeback drain failed, will retry via cron:", err)
    })
  }

  return {
    markedRead: markRead,
    archived: canArchive,
  }
}
