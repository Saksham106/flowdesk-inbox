import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const VALID_STATUSES = ["none", "proposed", "approved"] as const

export async function PATCH(
  request: Request,
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
  })

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  const payload = await request.json()
  const text = typeof payload?.text === "string" ? payload.text.trim() : undefined
  const status = typeof payload?.status === "string" ? payload.status : undefined
  const kbDocId = typeof payload?.kbDocId === "string" ? payload.kbDocId : undefined

  if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid draft status" }, { status: 400 })
  }

  if (text !== undefined) {
    if (!text) {
      return NextResponse.json({ error: "Draft text is required" }, { status: 400 })
    }

    const draft = await prisma.draft.update({
      where: { conversationId: conversation.id },
      data: { text, status: "proposed" },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        action: "draft.edit",
        payloadJson: { conversationId: conversation.id, draftId: draft.id },
      },
    })

    if (kbDocId) {
      await prisma.auditLog.create({
        data: {
          tenantId: session.user.tenantId,
          action: "support.kb_match_draft",
          payloadJson: {
            conversationId: params.id,
            kbDocId,
          },
        },
      })
    }

    return NextResponse.json({ draft })
  }

  if (!status) {
    return NextResponse.json({ error: "Draft text or status is required" }, { status: 400 })
  }

  const data =
    status === "none"
      ? { status: "none" as const, text: "" }
      : { status: status as "proposed" | "approved" }

  const draft = await prisma.draft.update({
    where: { conversationId: conversation.id },
    data,
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: status === "approved" ? "draft.approve" : "draft.clear",
      payloadJson: { conversationId: conversation.id, draftId: draft.id },
    },
  })

  return NextResponse.json({ draft })
}
