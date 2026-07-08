import { NextResponse } from "next/server"

import { runGmailLabelReconcileCron } from "@/lib/agent/gmail-label-reconcile"

export const runtime = "nodejs"

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
 * every other tenant's slice of the run's work. Shared with the in-process
 * scheduler (lib/scheduler) via runGmailLabelReconcileCron — this route is a
 * thin, CRON_SECRET-gated wrapper for manual/external triggering.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runGmailLabelReconcileCron()

  return NextResponse.json(result, {
    status: result.errors > 0 ? 500 : 200,
    headers: { "X-Gmail-Label-Reconcile-Errors": String(result.errors) },
  })
}
