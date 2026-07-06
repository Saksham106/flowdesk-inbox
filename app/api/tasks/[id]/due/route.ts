import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { metadataWithUserEditedField } from "@/lib/agent/user-edited-fields"
import type { Prisma } from "@prisma/client"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const dueAt = body.dueAt ? new Date(body.dueAt) : null

  if (dueAt !== null && isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  }

  const task = await prisma.inboxTask.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updated = await prisma.inboxTask.update({
    where: { id: params.id },
    data: {
      dueAt,
      source: "user",
      metadataJson: metadataWithUserEditedField(task.metadataJson, "dueAt") as Prisma.InputJsonValue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "inbox_task.due_date_updated",
      payloadJson: { taskId: params.id, dueAt: dueAt?.toISOString() ?? null },
    },
  })

  return NextResponse.json(updated)
}
