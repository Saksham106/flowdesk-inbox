import { NextResponse } from "next/server"
import { processOutlookSyncWork } from "@/lib/outlook-worker"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || request.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await processOutlookSyncWork()
  return NextResponse.json(result, {
    status: result.errors > 0 ? 500 : 200,
    headers: { "X-Outlook-Sync-Errors": String(result.errors) },
  })
}
