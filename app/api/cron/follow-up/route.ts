import { NextResponse } from "next/server"
import { runFollowUpBatch, runFollowUpLabelSweep } from "@/lib/agent/follow-up"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Label sweep runs for every tenant (waiting_on → Follow Up label once the
    // delay elapses); the job batch below stays opt-in via FollowUpSetting.
    const labelSweep = await runFollowUpLabelSweep()
    const result = await runFollowUpBatch()
    return NextResponse.json({ ok: true, ...result, labelSweep })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Follow-up batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
