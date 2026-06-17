import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

const ALLOWED_STATUSES = ["active", "dismissed", "suggested"]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const body = await request.json()
  if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 422 })
  }
  const rule = await prisma.agentRule.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const [updated] = await prisma.$transaction([
    prisma.agentRule.update({
      where: { id: params.id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.plainText && { plainText: body.plainText }),
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.update",
        payloadJson: { id: params.id, status: body.status, plainText: body.plainText } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ rule: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  await prisma.$transaction([
    prisma.agentRule.deleteMany({
      where: { id: params.id, tenantId },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.delete",
        payloadJson: { id: params.id } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ ok: true })
}
