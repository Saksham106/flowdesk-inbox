import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const body = await req.json()
  const { conversationId, title, dueAt } = body

  if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 })
  if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })

  const parsedDueAt = dueAt ? new Date(dueAt) : null
  if (parsedDueAt !== null && isNaN(parsedDueAt.getTime())) {
    return NextResponse.json({ error: "Invalid due date" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const task = await prisma.inboxTask.create({
    data: {
      tenantId,
      conversationId,
      title: title.trim(),
      status: "open",
      source: "manual",
      deterministicKey: `manual_${conversationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dueAt: parsedDueAt,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "inbox_task.manually_created",
      payloadJson: { taskId: task.id, conversationId, title: task.title, reason: "User manually created a task" },
    },
  })

  return NextResponse.json({ task }, { status: 201 })
}
