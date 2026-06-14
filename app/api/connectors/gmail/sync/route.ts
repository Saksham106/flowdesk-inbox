import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { syncGmailChannel, syncGmailChannelIncremental, watchGmailChannel } from "@/lib/google"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { channelId, incremental } = await request.json()
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 })
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId: session.user.tenantId, type: "email" },
  })

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  }

  try {
    let result
    if (incremental) {
      const cred = await prisma.gmailCredential.findUnique({ where: { channelId } })
      if (cred?.historyId) {
        result = await syncGmailChannelIncremental(channelId, session.user.tenantId)
      } else {
        const count = await syncGmailChannel(channelId, session.user.tenantId)
        result = { synced: count }
      }

      if (process.env.GMAIL_PUSH_TOPIC) {
        try {
          await watchGmailChannel(channelId, process.env.GMAIL_PUSH_TOPIC)
        } catch {
          // Non-blocking, log but don't fail sync
          console.warn("Failed to setup Gmail watch for channel", channelId)
        }
      }
    } else {
      const count = await syncGmailChannel(channelId, session.user.tenantId)
      result = { synced: count }
    }

    await prisma.gmailCredential.update({
      where: { channelId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error"

    await prisma.gmailCredential.update({
      where: { channelId },
      data: { lastSyncError: message },
    }).catch(() => {})

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
