import { prisma } from "@/lib/prisma"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { ensureFlowDeskLabels } from "@/lib/google"

export type GmailLabelReconcileResult = {
  labelsEnsured: boolean
  labelsEnsureError: string | null
  scanned: number
  queued: number
  errors: number
}

// Shared by the gmail-label-reconcile cron (bounded rolling maintenance) and
// the user-triggered "Fix Gmail labels" action (a larger one-time catch-up).
// Re-ensures the label set exists/is colored on the Gmail side, then
// re-projects labels for a bounded, recency-ordered batch of conversations —
// this is the only path that reprocesses conversations Gmail's own history
// API wouldn't resurface as "new" (label state is a local decision, not
// something a Gmail sync naturally re-triggers for unchanged threads).
export async function reconcileGmailLabelsForChannel(
  channel: { id: string; tenantId: string },
  options: { windowDays: number; batchSize: number }
): Promise<GmailLabelReconcileResult> {
  let labelsEnsured = false
  let labelsEnsureError: string | null = null
  try {
    await ensureFlowDeskLabels(channel.id)
    labelsEnsured = true
  } catch (err) {
    labelsEnsureError = err instanceof Error ? err.message : "Unknown error ensuring labels"
  }

  const cutoff = new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000)
  const conversations = await prisma.conversation.findMany({
    where: {
      channelId: channel.id,
      externalThreadId: { not: "" },
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
    take: options.batchSize,
  })

  let queued = 0
  let errors = 0

  for (const conversation of conversations) {
    try {
      const job = await projectFlowDeskLabelsForConversation({
        tenantId: channel.tenantId,
        conversationId: conversation.id,
      })
      if (job) queued++
    } catch {
      errors++
    }
  }

  return {
    labelsEnsured,
    labelsEnsureError,
    scanned: conversations.length,
    queued,
    errors,
  }
}
