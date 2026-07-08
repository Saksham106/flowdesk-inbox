import { prisma } from "@/lib/prisma"
import { runGmailSync } from "@/lib/gmail-sync"

export type GmailPushRetryResult = {
  retried: number
  errors: number
}

// Retries Gmail push notifications that failed processing (transient Gmail
// API errors, brief outages) — pulled from GmailPushEvent rather than
// re-delivered by Pub/Sub, since Pub/Sub only redelivers within its own ack
// deadline window.
export async function runGmailPushRetryCron(): Promise<GmailPushRetryResult> {
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

  return { retried, errors }
}
