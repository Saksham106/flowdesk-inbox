import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const body = await request.json()
  const snippet = await prisma.snippet.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!snippet) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updateData = {
    ...(body.status && { status: body.status }),
    ...(body.title && { title: body.title }),
    ...(body.content && { content: body.content }),
    ...(body.incrementUseCount && { useCount: { increment: 1 } }),
  }

  // Only audit status mutations (approve/dismiss), not useCount increments
  if (body.status) {
    const [updated] = await prisma.$transaction([
      prisma.snippet.update({ where: { id: params.id }, data: updateData }),
      prisma.auditLog.create({
        data: {
          tenantId,
          action: "snippet.update",
          payloadJson: { id: params.id, status: body.status } as Prisma.InputJsonValue,
        },
      }),
    ])
    return NextResponse.json({ snippet: updated })
  }

  const updated = await prisma.snippet.update({ where: { id: params.id }, data: updateData })
  return NextResponse.json({ snippet: updated })
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  await prisma.$transaction([
    prisma.snippet.deleteMany({ where: { id: params.id, tenantId } }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "snippet.delete",
        payloadJson: { id: params.id } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ ok: true })
}
