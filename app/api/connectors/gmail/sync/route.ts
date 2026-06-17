import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { runGmailSync } from "@/lib/gmail-sync"
import { revalidateInboxViews } from "@/lib/cache-tags"

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
    const result = await runGmailSync({
      channelId,
      tenantId: session.user.tenantId,
      requestedMode: "manual",
      incremental: Boolean(incremental),
      ensureWatch: true,
    })

    revalidateInboxViews(session.user.tenantId)
    return NextResponse.json(result, { status: result.skipped === "sync_in_progress" ? 202 : 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
