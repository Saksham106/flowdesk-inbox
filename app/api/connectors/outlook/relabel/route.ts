import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { runRelabelCatchUp, RELABEL_BATCH_SIZE } from "@/lib/agent/email-label-reconcile"
import { getAutomationLevel, isActionAllowedAtLevel, MIN_LEVEL_FOR_ACTION } from "@/lib/agent/automation-level"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

// A one-time, user-triggered catch-up — separate from "Sync now" (which only
// pulls new provider history and never revisits unchanged conversations).
// Covers accounts that connected before category colors/reliability fixes
// existed, or whose category writebacks are stuck from before those fixes
// landed. The actual per-channel work (window/batch, ensure + re-project) is
// shared with the Gmail relabel route and the maintenance cron via
// runRelabelCatchUp (lib/agent/email-label-reconcile.ts); this route is just
// the session-authed, Outlook-scoped wrapper around it.
export async function POST(_request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runRelabelCatchUp({ tenantId: session.user.tenantId, provider: "microsoft" })

  if (result.channels === 0) {
    return NextResponse.json({ error: "No connected Outlook account found" }, { status: 404 })
  }

  // runRelabelCatchUp/reconcileLabelsForChannel silently skips every
  // conversation when the tenant's automation level is below the gate for
  // apply_gmail_labels — indistinguishable from "genuinely nothing to fix"
  // from the counts alone. Surface it explicitly so the button can tell the
  // user the real reason instead of a misleading "already up to date".
  const automationLevel = await getAutomationLevel(session.user.tenantId)
  const belowAutomationLevel = !isActionAllowedAtLevel(automationLevel, "apply_gmail_labels")

  // A full batch means there may be older conversations this pass didn't
  // reach — surfaced to the client instead of it guessing from the batch size.
  const hasMore = result.scanned >= RELABEL_BATCH_SIZE

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "outlook.labels.relabel_requested",
      payloadJson: {
        channels: result.channels,
        labelsEnsured: result.labelsEnsured,
        scanned: result.scanned,
        queued: result.queued,
        errors: result.errors,
      },
    },
  })

  revalidateInboxViews(session.user.tenantId)

  return NextResponse.json(
    {
      channels: result.channels,
      labelsEnsured: result.labelsEnsured,
      scanned: result.scanned,
      queued: result.queued,
      errors: result.errors,
      hasMore,
      automationLevel,
      belowAutomationLevel,
      minAutomationLevel: MIN_LEVEL_FOR_ACTION.apply_gmail_labels,
    },
    { status: result.errors > 0 && result.queued === 0 ? 500 : 200 }
  )
}
