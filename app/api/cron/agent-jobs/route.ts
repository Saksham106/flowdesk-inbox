import { NextResponse } from "next/server"
import { processAgentJobWork } from "@/lib/agent/job-executor"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || request.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await processAgentJobWork()
  return NextResponse.json(result, {
    status: result.failed > 0 ? 500 : 200,
    headers: { "X-Agent-Jobs-Errors": String(result.failed) },
  })
}
