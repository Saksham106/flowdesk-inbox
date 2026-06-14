import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { renewGmailWatchIfNeeded, stopGmailWatch } from "@/lib/google"

export const runtime = "nodejs"

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
    where: { historyId: { not: null } },
    include: { channel: true },
  })

  let renewed = 0
  let errors = 0

  for (const cred of channels) {
    try {
      const renewedChannel = await renewGmailWatchIfNeeded(cred.channelId, topicName)
      if (renewedChannel) renewed++
    } catch (err) {
      console.error(`Failed to renew watch for channel ${cred.channelId}:`, err)
      errors++
    }
  }

  return NextResponse.json({ renewed, errors })
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
      data: { historyId: null },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}