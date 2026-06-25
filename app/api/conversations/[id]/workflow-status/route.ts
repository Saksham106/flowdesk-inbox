// app/api/conversations/[id]/workflow-status/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { revalidateInboxViews } from "@/lib/cache-tags"
import { conversationUpdateForWorkflowStatus, type SettableWorkflowStatus } from "@/lib/workflow-status-transitions"

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

  await prisma.conversation.update({
    where: { id: params.id, tenantId: session.user.tenantId },
    data: conversationUpdateForWorkflowStatus(workflowStatus as SettableWorkflowStatus),
  })

  revalidateInboxViews(session.user.tenantId, params.id)
  return NextResponse.json({ ok: true })
}
