import { NextResponse } from "next/server"

import { getSchedulerStatus, isSchedulerStarted } from "@/lib/scheduler/run-scheduler"

export const runtime = "nodejs"

// Ops visibility into the in-process scheduler (lib/scheduler) — CRON_SECRET-
// gated like the /api/cron/* routes rather than session-authenticated: job
// status is process-wide operational data (job names, run counts, error
// messages that may reference cross-tenant batches), not scoped to a single
// tenant, so it shouldn't be reachable by any logged-in user.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    started: isSchedulerStarted(),
    jobs: getSchedulerStatus(),
  })
}
