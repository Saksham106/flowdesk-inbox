import { NextResponse } from "next/server"

import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { ensureFlowDeskLabels } from "@/lib/google"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

// Bounded work per run: labels drift slowly (a user moving/removing FlowDesk
// labels by hand in Gmail, or a writeback that failed out of its retry
// budget), so a small rolling window converges within a few runs.
const RECONCILE_WINDOW_DAYS = 14
const RECONCILE_BATCH_SIZE = 50

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown Gmail label reconcile error"
}

/**
 * Gmail label maintenance: per connected Gmail channel, makes sure the
 * FlowDesk label vocabulary exists (idempotent — labels get re-created if the
 * user deleted them), then re-projects labels for a bounded batch of
 * recently-active conversations whose Gmail labels may have drifted. All
 * mutations go through the existing writeback queue (projection upserts on
 * conversationId+action), so no claim/lease is needed here and overlapping
 * runs are safe. The projection itself enforces the automation level, tenant
 * label settings, and manual user workflow choices.
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
  let errors = 0

  for (const channel of channels) {
    try {
      await ensureFlowDeskLabels(channel.id)
      labelsEnsured++
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`[gmail-label-reconcile] ensure labels failed for channel ${channel.id}:`, err)
      errors++
      await prisma.auditLog
        .create({
          data: {
            tenantId: channel.tenantId,
            action: "gmail.labels.ensure_failed",
            payloadJson: { channelId: channel.id, error: message },
          },
        })
        .catch(() => {})
    }
  }

  const cutoff = new Date(Date.now() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const conversations = await prisma.conversation.findMany({
    where: {
      channel: { provider: "google" },
      externalThreadId: { not: "" },
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, tenantId: true },
    take: RECONCILE_BATCH_SIZE,
  })

  let queued = 0

  for (const conversation of conversations) {
    try {
      const job = await projectFlowDeskLabelsForConversation({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
      })
      if (job) queued++
    } catch (err) {
      console.error(
        `[gmail-label-reconcile] projection failed for conversation ${conversation.id}:`,
        err
      )
      errors++
    }
  }

  return NextResponse.json(
    { channels: channels.length, labelsEnsured, scanned: conversations.length, queued, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Label-Reconcile-Errors": String(errors) },
    }
  )
}
