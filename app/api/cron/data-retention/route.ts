import { NextResponse } from "next/server"
import { runDataRetentionCron } from "@/lib/agent/data-retention"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET env var is not set — data-retention cron will always reject")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runDataRetentionCron()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "data-retention run failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
