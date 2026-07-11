import { prisma } from "@/lib/prisma"

export type EmailStateReconcileResult = {
  drifted: number
  queued: number
  reconciled: number
}

const RECONCILE_WINDOW_DAYS = 30

// Local read state and raw provider (Gmail/Outlook) state are stored
// separately (see docs/CURRENT_STATE.md) so provider syncs never clobber
// explicit user choices. That means the two can drift: a message read
// locally but still unread at the provider (or vice versa). Auto-reconciles
// drift that wasn't user-initiated (userStateSource !== "user"); queues a
// mark_read writeback for drift that was, so the user's own action reaches
// the provider rather than being silently overwritten.
export async function runEmailStateReconcileCron(): Promise<EmailStateReconcileResult> {
  const cutoff = new Date(Date.now() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const driftedConversations = await prisma.conversation.findMany({
    where: {
      lastMessageAt: { gte: cutoff },
      readAt: { not: null },
      gmailUnread: true,
      channel: { provider: { in: ["google", "microsoft"] } },
    },
    select: {
      id: true,
      tenantId: true,
      channelId: true,
      userStateSource: true,
      readAt: true,
      gmailUnread: true,
      channel: { select: { provider: true } },
      messages: { select: { providerMessageId: true } },
    },
    take: 100,
  })

  let queued = 0
  let reconciled = 0

  for (const conversation of driftedConversations) {
    const isMicrosoft = conversation.channel?.provider === "microsoft"
    const driftType = isMicrosoft ? "local_read_provider_unread" : "local_read_gmail_unread"
    const driftLastError = isMicrosoft
      ? "Detected local read / provider unread drift"
      : "Detected local read / Gmail unread drift"
    const providerMessageIds = conversation.messages.map((message) => message.providerMessageId)
    await prisma.auditLog.create({
      data: {
        tenantId: conversation.tenantId,
        action: "conversation_state.drift_detected",
        payloadJson: {
          conversationId: conversation.id,
          driftType,
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
            driftType,
            source: conversation.userStateSource,
            reconciledAt: reconciledAt.toISOString(),
          },
        },
      })
      reconciled++
      continue
    }

    await prisma.emailWritebackQueue.upsert({
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
        lastError: driftLastError,
        status: "pending",
        nextAttemptAt: new Date(),
      },
      update: {
        providerMessageIdsJson: providerMessageIds,
        lastError: driftLastError,
        status: "pending",
        nextAttemptAt: new Date(),
      },
    })
    queued++
  }

  return { drifted: driftedConversations.length, queued, reconciled }
}
