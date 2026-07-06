import { NextResponse } from "next/server"

import { runGmailSync } from "@/lib/gmail-sync"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const events = await prisma.gmailPushEvent.findMany({
    where: { status: "failed" },
    orderBy: { createdAt: "asc" },
    take: 25,
    include: { channel: { include: { gmailCredential: true } } },
  })

  let retried = 0
  let errors = 0

  for (const event of events) {
    try {
      await prisma.gmailPushEvent.update({
        where: { messageId: event.messageId },
        data: { status: "processing", error: null },
      })
      await runGmailSync({
        channelId: event.channelId,
        tenantId: event.tenantId,
        requestedMode: "push",
        incremental: Boolean(event.channel.gmailCredential?.historyId),
        ensureWatch: Boolean(process.env.GMAIL_PUSH_TOPIC),
      })
      await prisma.gmailPushEvent.update({
        where: { messageId: event.messageId },
        data: { status: "completed", error: null, processedAt: new Date() },
      })
      retried++
    } catch (err) {
      errors++
      await prisma.gmailPushEvent
        .update({
          where: { messageId: event.messageId },
          data: {
            status: "failed",
            error: err instanceof Error ? err.message : "Unknown Gmail push retry error",
            processedAt: new Date(),
          },
        })
        .catch(() => {})
    }
  }

  return NextResponse.json(
    { retried, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Push-Retry-Errors": String(errors) },
    }
  )
}
