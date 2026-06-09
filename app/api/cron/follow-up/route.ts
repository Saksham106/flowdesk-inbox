import { NextResponse } from "next/server"
import { runFollowUpBatch } from "@/lib/agent/follow-up"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runFollowUpBatch()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Follow-up batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
