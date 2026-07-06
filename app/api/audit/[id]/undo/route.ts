import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ensureDraftApprovalRequest } from "@/lib/agent/approvals"

export const runtime = "nodejs"

const UNDOABLE_ACTIONS = new Set(["autopilot.draft_approved"])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const logId = params.id

  const log = await prisma.auditLog.findFirst({
    where: { id: logId, tenantId },
  })
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!UNDOABLE_ACTIONS.has(log.action)) {
    return NextResponse.json({ error: "This action cannot be undone" }, { status: 422 })
  }

  const payload = log.payloadJson as Record<string, unknown>

  if (log.action === "autopilot.draft_approved") {
    const draftId = payload.draftId as string | undefined
    if (!draftId) return NextResponse.json({ error: "No draft ID in log" }, { status: 422 })

    // Scope the update through the conversation relation to enforce tenant isolation.
    const result = await prisma.draft.updateMany({
      where: { id: draftId, conversation: { tenantId } },
      data: { status: "proposed" },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 })
    }

    // The draft is proposed again, so re-open its pending approval request
    // (proposed draft => pending approval is the unified-queue invariant).
    if (typeof payload.conversationId === "string") {
      await ensureDraftApprovalRequest({
        tenantId,
        conversationId: payload.conversationId,
        draftId,
        source: "autopilot_approval_undo",
      })
    }

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id ?? null,
        action: "autopilot.draft_approval_undone",
        payloadJson: {
          originalLogId: logId,
          draftId,
          conversationId: typeof payload.conversationId === "string" ? payload.conversationId : undefined,
          reason: "User undid autopilot draft approval",
        },
      },
    })

    return NextResponse.json({ ok: true, message: "Draft set back to proposed for review." })
  }

  return NextResponse.json({ error: "Undo not implemented for this action" }, { status: 422 })
}
