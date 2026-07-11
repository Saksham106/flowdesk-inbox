import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getWritebackAdapter } from "@/lib/email/writeback-adapter"
import { revalidateInboxViews } from "@/lib/cache-tags"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await request.json()
  const read = payload?.read

  if (typeof read !== "boolean") {
    return NextResponse.json({ error: "Missing read boolean" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: {
      id: true,
      channelId: true,
      channel: { select: { provider: true } },
      messages: { select: { providerMessageId: true } },
    },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data: {
      readAt: read ? new Date() : null,
      gmailUnread: read ? false : true,
    },
  })

  const adapter = getWritebackAdapter(conversation.channel.provider)

  if (read && adapter) {
    await prisma.message.updateMany({
      where: { conversationId: params.id },
      data: { isRead: true },
    })
    adapter.markConversationRead(
      conversation.channelId,
      conversation.messages.map((message) => message.providerMessageId),
      { tenantId: session.user.tenantId, conversationId: params.id }
    ).catch((err) => {
      console.warn("Failed to mark thread read after read toggle", {
        conversationId: params.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
    })
  }

  revalidateInboxViews(session.user.tenantId, params.id)
  return NextResponse.json({ ok: true })
}
