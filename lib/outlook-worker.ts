import { runOutlookDeltaSync } from "@/lib/outlook-sync"
import { ensureOutlookSubscription } from "@/lib/outlook-subscriptions"
import { prisma } from "@/lib/prisma"

const BATCH_SIZE = 25
const EVENT_CLAIM_MS = 5 * 60 * 1000
const FALLBACK_INTERVAL_MS = 15 * 60 * 1000

export async function processOutlookSyncWork() {
  const now = new Date()
  const dueEvents = await prisma.outlookSyncEvent.findMany({
    where: {
      nextAttemptAt: { lte: now },
      OR: [
        { status: "pending" },
        { status: "processing" },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, channelId: true, tenantId: true, status: true },
  })

  const claimed = []
  for (const event of dueEvents) {
    const result = await prisma.outlookSyncEvent.updateMany({
      where: {
        id: event.id,
        status: event.status,
        nextAttemptAt: { lte: now },
      },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        lastError: null,
        nextAttemptAt: new Date(now.getTime() + EVENT_CLAIM_MS),
      },
    })
    if (result.count === 1) claimed.push(event)
  }

  let completedEvents = 0
  let deferredEvents = 0
  let errors = 0
  const processedChannels = new Set<string>()
  const byChannel = new Map<string, typeof claimed>()
  for (const event of claimed) {
    const group = byChannel.get(event.channelId) ?? []
    group.push(event)
    byChannel.set(event.channelId, group)
  }

  for (const [channelId, events] of byChannel) {
    const ids = events.map((event) => event.id)
    try {
      const result = await runOutlookDeltaSync({
        channelId,
        tenantId: events[0].tenantId,
        requestedMode: "webhook",
      })
      processedChannels.add(channelId)
      const skipped = "skipped" in result ? result.skipped : undefined
      const hasMore = "hasMore" in result && result.hasMore
      if (skipped || hasMore) {
        deferredEvents += ids.length
        await rescheduleEvents(ids, skipped === "sync_in_progress" ? 60_000 : 5_000)
      } else {
        completedEvents += ids.length
        await prisma.outlookSyncEvent.updateMany({
          where: { id: { in: ids }, status: "processing" },
          data: { status: "completed", processedAt: new Date(), lastError: null },
        })
      }
    } catch {
      errors++
      deferredEvents += ids.length
      await prisma.outlookSyncEvent.updateMany({
        where: { id: { in: ids }, status: "processing" },
        data: {
          status: "pending",
          lastError: "sync_failed",
          nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      }).catch(() => undefined)
    }
  }

  const renewable = await prisma.outlookCredential.findMany({
    where: {
      channel: { provider: "microsoft" },
      OR: [
        { subscriptionId: null },
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) } },
      ],
    },
    orderBy: { subscriptionExpiresAt: "asc" },
    take: BATCH_SIZE,
    select: { channelId: true, channel: { select: { tenantId: true } } },
  })
  let renewed = 0
  for (const credential of renewable) {
    try {
      const result = await ensureOutlookSubscription(credential.channelId)
      if ("renewed" in result && result.renewed) renewed++
    } catch (error) {
      errors++
      const message = error instanceof Error ? error.message : "Unknown Outlook renewal error"
      await prisma.outlookCredential
        .update({
          where: { channelId: credential.channelId },
          data: {
            subscriptionError: message,
            subscriptionLastRenewalAttempt: new Date(),
          },
        })
        .catch(() => {})
      await prisma.auditLog
        .create({
          data: {
            tenantId: credential.channel.tenantId,
            action: "outlook.subscription.renewal_failed",
            payloadJson: { channelId: credential.channelId, error: message },
          },
        })
        .catch(() => {})
    }
  }

  const stale = await prisma.outlookCredential.findMany({
    where: {
      channel: { provider: "microsoft" },
      OR: [
        { lastSyncStatus: { in: ["partial", "cursor_reset"] } },
        { lastSyncedAt: null },
        { lastSyncedAt: { lte: new Date(now.getTime() - FALLBACK_INTERVAL_MS) } },
      ],
    },
    orderBy: { lastSyncedAt: "asc" },
    take: BATCH_SIZE,
    select: { channelId: true, channel: { select: { tenantId: true } } },
  })
  let fallbackSyncs = 0
  for (const credential of stale) {
    if (processedChannels.has(credential.channelId)) continue
    try {
      await runOutlookDeltaSync({
        channelId: credential.channelId,
        tenantId: credential.channel.tenantId,
        requestedMode: "cron",
      })
      fallbackSyncs++
    } catch (error) {
      errors++
      // runOutlookDeltaSync already records lastSyncStatus/lastSyncError on
      // the credential in its own catch before rethrowing — only the audit
      // trail is this worker's responsibility.
      const message = error instanceof Error ? error.message : "Unknown Outlook sync error"
      await prisma.auditLog
        .create({
          data: {
            tenantId: credential.channel.tenantId,
            action: "outlook.sync.failed",
            payloadJson: { channelId: credential.channelId, error: message },
          },
        })
        .catch(() => {})
    }
  }

  return { completedEvents, deferredEvents, renewed, fallbackSyncs, errors }
}

async function rescheduleEvents(ids: string[], delayMs: number) {
  await prisma.outlookSyncEvent.updateMany({
    where: { id: { in: ids }, status: "processing" },
    data: {
      status: "pending",
      nextAttemptAt: new Date(Date.now() + delayMs),
    },
  })
}
