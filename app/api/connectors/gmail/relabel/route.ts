import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { reconcileGmailLabelsForChannel } from "@/lib/agent/gmail-label-reconcile"
import { getAutomationLevel, isActionAllowedAtLevel, MIN_LEVEL_FOR_ACTION } from "@/lib/agent/automation-level"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

// A one-time, user-triggered catch-up — separate from "Sync now" (which only
// pulls new Gmail history and never revisits unchanged conversations). Covers
// accounts that connected before label colors/reliability fixes existed, or
// whose label writebacks are stuck from before those fixes landed: existing
// FlowDeskGmailWritebackQueue rows for this conversation get reset to
// "pending" and re-attempted (see queueFlowDeskLabelWriteback's upsert), so a
// job that permanently failed under old, buggy code gets a fresh shot with
// the fixed code — no reconnect or different Gmail account required.
//
// Wider window and larger batch than the maintenance cron (14 days / 50)
// since this is explicitly asked for, not a background rolling sweep. Still
// bounded to keep the request from running indefinitely; a second click
// picks up the next most-recent batch if more remain.
const RELABEL_WINDOW_DAYS = 365
const RELABEL_BATCH_SIZE = 100

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { channelId?: string }

  const channels = await prisma.channel.findMany({
    where: {
      tenantId: session.user.tenantId,
      provider: "google",
      gmailCredential: { isNot: null },
      ...(body.channelId ? { id: body.channelId } : {}),
    },
    select: { id: true, tenantId: true },
  })

  if (channels.length === 0) {
    return NextResponse.json({ error: "No connected Gmail account found" }, { status: 404 })
  }

  // reconcileGmailLabelsForChannel silently returns null for every
  // conversation when the tenant's automation level is below the gate for
  // apply_gmail_labels — indistinguishable from "genuinely nothing to fix"
  // from the counts alone. Surface it explicitly so the button can tell the
  // user the real reason instead of a misleading "already up to date".
  const automationLevel = await getAutomationLevel(session.user.tenantId)
  const belowAutomationLevel = !isActionAllowedAtLevel(automationLevel, "apply_gmail_labels")

  let labelsEnsured = 0
  let scanned = 0
  let queued = 0
  let errors = 0
  let hasMore = false

  for (const channel of channels) {
    const result = await reconcileGmailLabelsForChannel(channel, {
      windowDays: RELABEL_WINDOW_DAYS,
      batchSize: RELABEL_BATCH_SIZE,
    })
    if (result.labelsEnsured) labelsEnsured++
    scanned += result.scanned
    queued += result.queued
    errors += result.errors
    // A full batch means there may be older conversations this pass didn't
    // reach — surfaced to the client instead of it guessing from the batch size.
    if (result.scanned >= RELABEL_BATCH_SIZE) hasMore = true
  }

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "gmail.labels.relabel_requested",
      payloadJson: { channels: channels.length, labelsEnsured, scanned, queued, errors },
    },
  })

  revalidateInboxViews(session.user.tenantId)

  return NextResponse.json(
    {
      channels: channels.length,
      labelsEnsured,
      scanned,
      queued,
      errors,
      hasMore,
      automationLevel,
      belowAutomationLevel,
      minAutomationLevel: MIN_LEVEL_FOR_ACTION.apply_gmail_labels,
    },
    { status: errors > 0 && queued === 0 ? 500 : 200 }
  )
}
