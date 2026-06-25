// app/api/conversations/[id]/workflow-status/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ConversationStatus } from "@prisma/client"

const SETTABLE_STATUSES = new Set(["needs_reply", "waiting_on", "read_later", "done"])

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { workflowStatus?: string }
  const { workflowStatus } = body

  if (!workflowStatus || !SETTABLE_STATUSES.has(workflowStatus)) {
    return NextResponse.json({ error: "Invalid workflowStatus" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const now = new Date()
  const data: {
    userState: string | null
    userStateSource: string
    userStateUpdatedAt: Date
    status?: ConversationStatus
  } = {
    // "needs_reply" means "reset": clear userState so derive logic takes over
    userState: workflowStatus === "needs_reply" ? null : workflowStatus,
    userStateSource: "user",
    userStateUpdatedAt: now,
  }

  // Keep conversation.status in sync for backward compat with existing queries
  if (workflowStatus === "done") {
    data.status = ConversationStatus.closed
  } else if (workflowStatus === "needs_reply") {
    data.status = ConversationStatus.needs_reply
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json({ ok: true })
}
