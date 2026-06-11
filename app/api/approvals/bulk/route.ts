import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : []
  const decision = body?.decision as "approved" | "rejected" | undefined

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 })
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No ids provided" }, { status: 400 })
  }

  const owned = await prisma.approvalRequest.findMany({
    where: { id: { in: ids }, tenantId: session.user.tenantId, status: "pending" },
    select: { id: true },
  })
  const ownedIds = owned.map((r) => r.id)

  if (ownedIds.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  await prisma.approvalRequest.updateMany({
    where: { id: { in: ownedIds } },
    data: {
      status: decision,
      reviewerUserId: session.user.id ?? null,
      decidedAt: new Date(),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: `approval.bulk_${decision}`,
      payloadJson: { ids: ownedIds, count: ownedIds.length },
    },
  })

  return NextResponse.json({ updated: ownedIds.length })
}
