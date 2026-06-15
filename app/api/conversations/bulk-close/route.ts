import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Find conversation IDs where attentionCategory is quiet or fyi_done
  const quietStates = await prisma.conversationState.findMany({
    where: {
      tenantId,
      OR: [
        { metadataJson: { path: ["attentionCategory"], equals: "quiet" } },
        { metadataJson: { path: ["attentionCategory"], equals: "fyi_done" } },
        { state: "fyi_only" },
      ],
    },
    select: { conversationId: true },
  })

  const ids = quietStates.map((s) => s.conversationId)

  if (ids.length === 0) {
    return NextResponse.json({ closed: 0 })
  }

  const result = await prisma.conversation.updateMany({
    where: { id: { in: ids }, tenantId, status: { not: "closed" } },
    data: { status: "closed" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "inbox.bulk_close_fyi",
      payloadJson: {
        closedCount: result.count,
        conversationIds: ids,
        reason: "User bulk-archived safely-ignored conversations",
      },
    },
  })

  return NextResponse.json({ closed: result.count })
}
