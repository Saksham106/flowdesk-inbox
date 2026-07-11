import { prisma } from "@/lib/prisma"
import { projectFlowDeskLabelsForConversation } from "@/lib/email-labels"
import { getWritebackAdapter } from "@/lib/email/writeback-adapter"
import { auditPrefixForProvider } from "@/lib/email/provider-support"

export type EmailLabelReconcileResult = {
  labelsEnsured: boolean
  labelsEnsureError: string | null
  scanned: number
  queued: number
  errors: number
}

// Shared by the email-label-reconcile cron (bounded rolling maintenance) and
// the user-triggered "Fix labels" action (a larger one-time catch-up), for
// both Gmail and Outlook channels.
// Re-ensures the label set exists/is colored on the provider side, then
// re-projects labels for a bounded, recency-ordered batch of conversations —
// this is the only path that reprocesses conversations a provider's own
// history/delta API wouldn't resurface as "new" (label state is a local
// decision, not something a sync naturally re-triggers for unchanged threads).
export async function reconcileLabelsForChannel(
  channel: { id: string; tenantId: string; provider: string },
  options: { windowDays: number; batchSize: number }
): Promise<EmailLabelReconcileResult> {
  let labelsEnsured = false
  let labelsEnsureError: string | null = null
  try {
    const adapter = getWritebackAdapter(channel.provider)
    if (!adapter) throw new Error(`No writeback adapter for provider: ${channel.provider}`)
    await adapter.ensureLabels(channel.id)
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

export type EmailLabelReconcileCronResult = {
  channels: number
  labelsEnsured: number
  scanned: number
  queued: number
  errors: number
}

// Bounded work per run: labels drift slowly (a user moving/removing FlowDesk
// labels by hand in the mailbox, or a writeback that failed out of its retry
// budget), so a small rolling window converges within a few runs. Batches per
// channel (not globally) so one very active tenant can't consume every other
// tenant's slice of the run's work.
const RECONCILE_WINDOW_DAYS = 14
const RECONCILE_BATCH_SIZE = 50

export async function runEmailLabelReconcileCron(): Promise<EmailLabelReconcileCronResult> {
  const channels = await prisma.channel.findMany({
    where: {
      OR: [
        { provider: "google", gmailCredential: { isNot: null } },
        { provider: "microsoft", outlookCredential: { isNot: null } },
      ],
    },
    select: { id: true, tenantId: true, provider: true },
  })

  let labelsEnsured = 0
  let scanned = 0
  let queued = 0
  let errors = 0

  for (const channel of channels) {
    const result = await reconcileLabelsForChannel(channel, {
      windowDays: RECONCILE_WINDOW_DAYS,
      batchSize: RECONCILE_BATCH_SIZE,
    })
    if (result.labelsEnsured) {
      labelsEnsured++
    } else {
      errors++
      await prisma.auditLog
        .create({
          data: {
            tenantId: channel.tenantId,
            action: `${auditPrefixForProvider(channel.provider)}.labels.ensure_failed`,
            payloadJson: { channelId: channel.id, error: result.labelsEnsureError },
          },
        })
        .catch(() => {})
    }
    scanned += result.scanned
    queued += result.queued
    errors += result.errors
  }

  return { channels: channels.length, labelsEnsured, scanned, queued, errors }
}

export type RelabelCatchUpResult = {
  channels: number
  scanned: number
  queued: number
  errors: number
  labelsEnsured: number
}

// Wider window and larger batch than the maintenance cron (14 days / 50)
// since this is explicitly asked for by the user, not a background rolling
// sweep. Still bounded to keep the request from running indefinitely; a
// second click picks up the next most-recent batch if more remain.
const RELABEL_WINDOW_DAYS = 365
export const RELABEL_BATCH_SIZE = 100

// Shared by the Gmail and Outlook "Fix labels" catch-up routes. Existing
// EmailWritebackQueue rows for a conversation get reset to "pending" and
// re-attempted (see queueFlowDeskLabelWriteback's upsert), so a job that
// permanently failed under old, buggy code gets a fresh shot with the fixed
// code — no reconnect or different account required.
export async function runRelabelCatchUp(input: {
  tenantId: string
  provider: "google" | "microsoft"
}): Promise<RelabelCatchUpResult> {
  const credentialFilter =
    input.provider === "google"
      ? { gmailCredential: { isNot: null } }
      : { outlookCredential: { isNot: null } }

  const channels = await prisma.channel.findMany({
    where: {
      tenantId: input.tenantId,
      provider: input.provider,
      ...credentialFilter,
    },
    select: { id: true, tenantId: true, provider: true },
  })

  let labelsEnsured = 0
  let scanned = 0
  let queued = 0
  let errors = 0

  for (const channel of channels) {
    const result = await reconcileLabelsForChannel(channel, {
      windowDays: RELABEL_WINDOW_DAYS,
      batchSize: RELABEL_BATCH_SIZE,
    })
    if (result.labelsEnsured) labelsEnsured++
    scanned += result.scanned
    queued += result.queued
    errors += result.errors
  }

  return { channels: channels.length, labelsEnsured, scanned, queued, errors }
}
