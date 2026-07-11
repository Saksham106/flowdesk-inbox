import { NextResponse } from "next/server"

import { runEmailStateReconcileCron } from "@/lib/agent/email-state-reconcile"

export const runtime = "nodejs"

// Route path/name is historical (predates Outlook parity) — the job it
// triggers now reconciles read-state drift for every mailbox provider
// (Gmail and Outlook channels).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runEmailStateReconcileCron()
  return NextResponse.json(result)
}
