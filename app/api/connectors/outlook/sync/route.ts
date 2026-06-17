import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { syncOutlookChannel } from "@/lib/microsoft"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { channelId } = await request.json()
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 })
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId: session.user.tenantId, provider: "microsoft" },
  })
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  }

  try {
    const synced = await syncOutlookChannel(channelId, session.user.tenantId)
    revalidateInboxViews(session.user.tenantId)
    return NextResponse.json({ ok: true, synced })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed"
    await prisma.outlookCredential.update({
      where: { channelId },
      data: { lastSyncError: message },
    })
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
