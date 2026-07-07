import { NextResponse } from "next/server"

import { processPendingGmailWritebackJobs } from "@/lib/agent/gmail-writeback-processor"

export const runtime = "nodejs"

// Reliability backstop: most jobs are already drained inline right after
// they're queued (see lib/gmail-labels.ts), but this cron catches anything
// that failed inline, was queued while Gmail was briefly unavailable, or is
// due for a retry after backoff.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { processed, errors } = await processPendingGmailWritebackJobs(25)

  return NextResponse.json(
    { processed, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Writeback-Errors": String(errors) },
    }
  )
}
