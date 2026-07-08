import { NextResponse } from "next/server"

import { runGmailStateReconcileCron } from "@/lib/agent/gmail-state-reconcile"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runGmailStateReconcileCron()
  return NextResponse.json(result)
}
