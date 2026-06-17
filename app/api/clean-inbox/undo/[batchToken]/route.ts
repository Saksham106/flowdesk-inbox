import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { parseBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

export async function POST(
  _request: Request,
  { params }: { params: { batchToken: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const ids = parseBatchToken(params.batchToken)
  if (ids.length === 0) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 })

  // Verify within 1-hour window via auditLog
  const log = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      action: { in: ["clean_inbox.archive_batch", "clean_inbox.unsubscribe_batch"] },
      payloadJson: { path: ["batchToken"], equals: params.batchToken },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  })
  if (!log) return NextResponse.json({ error: "Undo window expired (1 hour)" }, { status: 410 })

  await prisma.conversation.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { status: "needs_reply" },
  })

  return NextResponse.json({ ok: true, restored: ids.length })
}
