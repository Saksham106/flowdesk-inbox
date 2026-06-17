import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buildBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    include: { stateRecord: { select: { metadataJson: true } } },
  })

  let unsubscribed = 0
  for (const conv of convs) {
    const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null
    const url = typeof meta?.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null
    if (url) {
      fetch(url, { method: "GET" }).catch(() => {})
      unsubscribed++
    }
    await prisma.conversation.update({
      where: { id: conv.id, tenantId },
      data: { status: "closed" },
    })
  }

  const batchToken = buildBatchToken(convs.map((c) => c.id))
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.unsubscribe_batch",
      payloadJson: { batchToken, conversationIds: convs.map((c) => c.id), unsubscribed } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true, processed: convs.length, unsubscribed, batchToken })
}
