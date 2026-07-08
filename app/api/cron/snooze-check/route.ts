import { NextResponse } from "next/server"
import { runSnoozeCheckCron } from "@/lib/agent/snooze-check"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runSnoozeCheckCron()
  return NextResponse.json(result)
}
