import { NextResponse } from "next/server"

import { runGmailPushRetryCron } from "@/lib/agent/gmail-push-retry"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { retried, errors } = await runGmailPushRetryCron()

  return NextResponse.json(
    { retried, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Push-Retry-Errors": String(errors) },
    }
  )
}
