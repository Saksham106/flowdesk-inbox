import { NextResponse } from "next/server"
import { runDueWorkflows } from "@/lib/agent/workflow-runner"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET env var is not set — workflow-runner cron will always reject")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const ran = await runDueWorkflows()
    return NextResponse.json({ ok: true, ran })
  } catch (err) {
    const message = err instanceof Error ? err.message : "workflow-runner cron failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
