import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { metadataWithUserEditedField } from "@/lib/agent/user-edited-fields"
import type { Prisma } from "@prisma/client"

const ALLOWED_STATUSES = ["open", "closed"] as const
type TaskStatus = (typeof ALLOWED_STATUSES)[number]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const status = body?.status as string | undefined

  if (!status || !ALLOWED_STATUSES.includes(status as TaskStatus)) {
    return NextResponse.json(
      { error: "status must be one of: open, closed" },
      { status: 400 }
    )
  }

  const task = await prisma.inboxTask.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  const updated = await prisma.inboxTask.update({
    where: { id: task.id },
    data: {
      status,
      source: "user",
      metadataJson: metadataWithUserEditedField(task.metadataJson, "status") as Prisma.InputJsonValue,
    },
    select: { id: true, title: true, status: true, dueAt: true, conversationId: true },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "inbox_task.status_changed",
      payloadJson: {
        taskId: task.id,
        conversationId: task.conversationId,
        from: task.status,
        to: status,
      },
    },
  })

  return NextResponse.json({ ok: true, task: updated })
}
