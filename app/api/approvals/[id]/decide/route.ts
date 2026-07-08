import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { projectDecisionOntoDraft } from "@/lib/agent/approvals"
import {
  bookSchedulingSession,
  APPROVAL_STEP_BOOK_EVENT,
} from "@/lib/agent/scheduling-booking"

const ALLOWED_DECISIONS = ["approved", "rejected"] as const
type Decision = (typeof ALLOWED_DECISIONS)[number]

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const decision = body?.decision as string | undefined
  const note = body?.note as string | undefined

  if (!decision || !ALLOWED_DECISIONS.includes(decision as Decision)) {
    return NextResponse.json(
      { error: "decision must be one of: approved, rejected" },
      { status: 400 }
    )
  }

  const approval = await prisma.approvalRequest.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId, status: "pending" },
  })

  if (!approval) {
    return NextResponse.json(
      { error: "Pending approval not found" },
      { status: 404 }
    )
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status: decision as Decision,
      decidedAt: new Date(),
      reviewerUserId: session.user.id,
      ...(note !== undefined ? { decisionNote: note } : {}),
    },
    select: {
      id: true,
      status: true,
      decidedAt: true,
      conversationId: true,
    },
  })

  if (approval.draftId) {
    await projectDecisionOntoDraft({
      tenantId: session.user.tenantId,
      draftId: approval.draftId,
      conversationId: approval.conversationId,
      decision: decision as Decision,
    })
  }

  // Approving a book_event request executes the booking. A calendar failure
  // does not undo the decision — the error lands on the scheduling session
  // (audited) and stays retryable from the conversation's Scheduling panel.
  if (approval.step === APPROVAL_STEP_BOOK_EVENT && decision === "approved") {
    await bookSchedulingSession({
      tenantId: session.user.tenantId,
      conversationId: approval.conversationId,
      trigger: "approval",
      actorUserId: session.user.id ?? null,
    })
  }

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "approval_request.decided",
      payloadJson: {
        approvalId: approval.id,
        conversationId: approval.conversationId,
        decision,
        note: note ?? null,
      },
    },
  })

  return NextResponse.json({ ok: true, approval: updated })
}
