import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { stopGmailWatch } from "@/lib/google"
import { runGmailWatchRenewalCron } from "@/lib/agent/gmail-watch-renewal"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runGmailWatchRenewalCron()
  if (result.skipped) {
    return NextResponse.json({ error: "GMAIL_PUSH_TOPIC not configured" }, { status: 500 })
  }

  return NextResponse.json(
    { renewed: result.renewed, errors: result.errors },
    {
      status: result.errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Watch-Errors": String(result.errors) },
    }
  )
}

export async function DELETE(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { channelId } = await request.json()
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 })
  }

  try {
    await stopGmailWatch(channelId)
    await prisma.gmailCredential.update({
      where: { channelId },
      data: { historyId: null, watchExpiresAt: null },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
