import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export const runtime = "nodejs"

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  const body = await request.json()

  const template = await prisma.workflowTemplate.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.workflowTemplate.update({
    where: { id: params.id },
    data: { ...(typeof body.enabled === "boolean" && { enabled: body.enabled }) },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "workflowTemplate.update",
      payloadJson: { id: params.id, enabled: body.enabled } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ template: updated })
}
