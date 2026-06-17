import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { renewGmailWatchIfNeeded, stopGmailWatch } from "@/lib/google"

export const runtime = "nodejs"

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown Gmail watch renewal error"
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const topicName = process.env.GMAIL_PUSH_TOPIC
  if (!topicName) {
    return NextResponse.json({ error: "GMAIL_PUSH_TOPIC not configured" }, { status: 500 })
  }

  const channels = await prisma.gmailCredential.findMany({
    where: {
      historyId: { not: null },
      OR: [
        { watchExpiresAt: null },
        { watchExpiresAt: { lt: new Date(Date.now() + 48 * 60 * 60 * 1000) } },
      ],
    },
    include: { channel: true },
  })

  let renewed = 0
  let errors = 0

  for (const cred of channels) {
    const attemptedAt = new Date()
    try {
      const renewedChannel = await renewGmailWatchIfNeeded(cred.channelId, topicName)
      if (renewedChannel) renewed++
      await prisma.gmailCredential.update({
        where: { channelId: cred.channelId },
        data: {
          watchLastRenewalAttempt: attemptedAt,
          watchRenewalError: null,
        },
      })
      await prisma.auditLog.create({
        data: {
          tenantId: cred.channel.tenantId,
          action: "gmail_watch.renewal_attempt",
          payloadJson: {
            channelId: cred.channelId,
            success: true,
            renewed: renewedChannel,
          },
        },
      })
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Failed to renew watch for channel ${cred.channelId}:`, err)
      errors++
      await prisma.gmailCredential
        .update({
          where: { channelId: cred.channelId },
          data: {
            watchLastRenewalAttempt: attemptedAt,
            watchRenewalError: message,
          },
        })
        .catch(() => {})
      await prisma.auditLog
        .create({
          data: {
            tenantId: cred.channel.tenantId,
            action: "gmail_watch.renewal_failed",
            payloadJson: {
              channelId: cred.channelId,
              success: false,
              error: message,
            },
          },
        })
        .catch(() => {})
    }
  }

  return NextResponse.json(
    { renewed, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Watch-Errors": String(errors) },
    }
  )
}

export async function DELETE(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
