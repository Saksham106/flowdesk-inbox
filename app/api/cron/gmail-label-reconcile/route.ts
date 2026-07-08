import { NextResponse } from "next/server"

import { reconcileGmailLabelsForChannel } from "@/lib/agent/gmail-label-reconcile"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// Bounded work per run: labels drift slowly (a user moving/removing FlowDesk
// labels by hand in Gmail, or a writeback that failed out of its retry
// budget), so a small rolling window converges within a few runs.
const RECONCILE_WINDOW_DAYS = 14
const RECONCILE_BATCH_SIZE = 50

/**
 * Gmail label maintenance: per connected Gmail channel, makes sure the
 * FlowDesk label vocabulary exists (idempotent — labels get re-created if the
 * user deleted them), then re-projects labels for a bounded batch of
 * recently-active conversations whose Gmail labels may have drifted. All
 * mutations go through the existing writeback queue (projection upserts on
 * conversationId+action), so no claim/lease is needed here and overlapping
 * runs are safe. The projection itself enforces the automation level, tenant
 * label settings, and manual user workflow choices.
 *
 * Batches per channel (not globally) so one very active tenant can't consume
 * every other tenant's slice of the run's work.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const channels = await prisma.channel.findMany({
    where: { provider: "google", gmailCredential: { isNot: null } },
    select: { id: true, tenantId: true },
  })

  let labelsEnsured = 0
  let scanned = 0
  let queued = 0
  let errors = 0

  for (const channel of channels) {
    const result = await reconcileGmailLabelsForChannel(channel, {
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
            action: "gmail.labels.ensure_failed",
            payloadJson: { channelId: channel.id, error: result.labelsEnsureError },
          },
        })
        .catch(() => {})
    }
    scanned += result.scanned
    queued += result.queued
    errors += result.errors
  }

  return NextResponse.json(
    { channels: channels.length, labelsEnsured, scanned, queued, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Label-Reconcile-Errors": String(errors) },
    }
  )
}
