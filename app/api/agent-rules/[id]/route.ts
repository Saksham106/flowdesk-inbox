import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const rule = await prisma.agentRule.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const updated = await prisma.agentRule.update({
    where: { id: params.id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.plainText && { plainText: body.plainText }),
    },
  })
  return NextResponse.json({ rule: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.agentRule.deleteMany({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  return NextResponse.json({ ok: true })
}
