import { prisma } from "@/lib/prisma"

export type GmailStateReconcileResult = {
  drifted: number
  queued: number
  reconciled: number
}

const RECONCILE_WINDOW_DAYS = 30

// Local read state and raw Gmail state are stored separately (see
// docs/CURRENT_STATE.md) so provider syncs never clobber explicit user
// choices. That means the two can drift: a message read locally but still
// unread in Gmail (or vice versa). Auto-reconciles drift that wasn't
// user-initiated (userStateSource !== "user"); queues a mark_read writeback
// for drift that was, so the user's own action reaches Gmail rather than
// being silently overwritten.
export async function runGmailStateReconcileCron(): Promise<GmailStateReconcileResult> {
  const cutoff = new Date(Date.now() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const driftedConversations = await prisma.conversation.findMany({
    where: {
      lastMessageAt: { gte: cutoff },
      readAt: { not: null },
      gmailUnread: true,
      channel: { provider: "google" },
    },
    select: {
      id: true,
      tenantId: true,
      channelId: true,
      userStateSource: true,
      readAt: true,
      gmailUnread: true,
      messages: { select: { providerMessageId: true } },
    },
    take: 100,
  })

  let queued = 0
  let reconciled = 0

  for (const conversation of driftedConversations) {
    const providerMessageIds = conversation.messages.map((message) => message.providerMessageId)
    await prisma.auditLog.create({
      data: {
        tenantId: conversation.tenantId,
        action: "conversation_state.drift_detected",
        payloadJson: {
          conversationId: conversation.id,
          driftType: "local_read_gmail_unread",
          readAt: conversation.readAt?.toISOString(),
          gmailUnread: conversation.gmailUnread,
        },
      },
    })

    if (conversation.userStateSource !== "user") {
      const reconciledAt = new Date()
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          readAt: null,
          userStateSource: "gmail_reconcile",
          userStateUpdatedAt: reconciledAt,
        },
      })
      await prisma.message.updateMany({
        where: { conversationId: conversation.id },
        data: { isRead: false },
      })
      await prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          action: "conversation_state.auto_reconciled",
          payloadJson: {
            conversationId: conversation.id,
            driftType: "local_read_gmail_unread",
            source: conversation.userStateSource,
            reconciledAt: reconciledAt.toISOString(),
          },
        },
      })
      reconciled++
      continue
    }

    await prisma.gmailWritebackQueue.upsert({
      where: {
        conversationId_action: {
          conversationId: conversation.id,
          action: "mark_read",
        },
      },
      create: {
        tenantId: conversation.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        action: "mark_read",
        providerMessageIdsJson: providerMessageIds,
        attempts: 0,
        lastError: "Detected local read / Gmail unread drift",
        status: "pending",
        nextAttemptAt: new Date(),
      },
      update: {
        providerMessageIdsJson: providerMessageIds,
        lastError: "Detected local read / Gmail unread drift",
        status: "pending",
        nextAttemptAt: new Date(),
      },
    })
    queued++
  }

  return { drifted: driftedConversations.length, queued, reconciled }
}
