import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buildBatchToken } from "@/lib/clean-inbox-token"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  // Verify all belong to tenant
  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    select: { id: true },
  })
  const validIds = convs.map((c) => c.id)

  await prisma.conversation.updateMany({
    where: { id: { in: validIds }, tenantId },
    data: { status: "closed" },
  })

  const batchToken = buildBatchToken(validIds)

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.archive_batch",
      payloadJson: { batchToken, conversationIds: validIds, count: validIds.length } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true, archived: validIds.length, batchToken })
}
