import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { ConversationSendError, sendConversationMessage } from "@/lib/conversations/send-message"
import { prisma } from "@/lib/prisma"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: params.id,
      tenantId: session.user.tenantId,
    },
    include: { channel: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  if (conversation.channel.type !== "email") {
    return NextResponse.json({ error: "Approved AI drafts are only available for email conversations" }, { status: 400 })
  }

  const draft = await prisma.draft.findUnique({
    where: { conversationId: conversation.id },
  })

  const text = draft?.text?.trim() ?? ""
  if (!draft || !text || !["proposed", "approved"].includes(draft.status)) {
    return NextResponse.json({ error: "No proposed or approved draft to send" }, { status: 400 })
  }

  if (draft.status !== "approved") {
    await prisma.draft.update({
      where: { conversationId: conversation.id },
      data: { status: "approved" },
    })
    await prisma.auditLog.create({
      data: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "draft.approve",
        payloadJson: { conversationId: conversation.id, draftId: draft.id },
      },
    })
  }

  try {
    await sendConversationMessage({
      conversationId: conversation.id,
      tenantId: session.user.tenantId,
      userId: session.user.id,
      text,
      auditAction: "conversation.send",
    })
  } catch (err) {
    if (err instanceof ConversationSendError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error("[draft/send-approved] unexpected error:", err)
    return NextResponse.json({ error: "Failed to send approved draft" }, { status: 500 })
  }

  await prisma.draft.update({
    where: { conversationId: conversation.id },
    data: { status: "sent" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: "draft.sent",
      payloadJson: { conversationId: conversation.id, draftId: draft.id },
    },
  })

  revalidateInboxViews(session.user.tenantId, conversation.id)
  return NextResponse.json({ ok: true })
}
