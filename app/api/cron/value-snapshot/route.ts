import { NextResponse } from "next/server"

import { runValueSnapshotCron } from "@/lib/agent/value-report"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET env var is not set — value-snapshot cron will always reject")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runValueSnapshotCron()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
