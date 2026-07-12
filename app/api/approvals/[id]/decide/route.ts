import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { projectDecisionOntoDraft } from "@/lib/agent/approvals"
import { ConversationSendError, sendConversationMessage } from "@/lib/conversations/send-message"
import { revalidateInboxViews } from "@/lib/cache-tags"
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

  // Approving a send-step draft actually sends the reply — that is what the
  // reviewer is approving. Previously this route only flipped the draft to
  // "approved" and the message silently went nowhere unless the user found
  // the separate send button in the conversation view (observed live
  // 2026-07-12 on an Outlook conversation). A send failure does not undo the
  // decision; it is audited and surfaced to the queue UI via `sendError`, and
  // the approved draft stays sendable from the conversation view.
  let sendError: string | null = null
  if (approval.step === "send" && approval.draftId && decision === "approved") {
    const draft = await prisma.draft.findFirst({
      where: { id: approval.draftId, conversation: { tenantId: session.user.tenantId } },
    })
    const text = draft?.text?.trim() ?? ""
    if (draft && text) {
      try {
        await sendConversationMessage({
          conversationId: approval.conversationId,
          tenantId: session.user.tenantId,
          userId: session.user.id,
          text,
          auditAction: "conversation.send",
        })
        await prisma.draft.update({
          where: { conversationId: approval.conversationId },
          data: { status: "sent", text: "" },
        })
        await prisma.auditLog.create({
          data: {
            tenantId: session.user.tenantId,
            userId: session.user.id,
            action: "draft.sent",
            payloadJson: { conversationId: approval.conversationId, draftId: draft.id },
          },
        })
        revalidateInboxViews(session.user.tenantId, approval.conversationId)
      } catch (err) {
        sendError =
          err instanceof ConversationSendError
            ? err.message
            : "Sending failed — the approved draft is still available in the conversation."
        console.error("[approvals/decide] send after approve failed:", err)
        await prisma.auditLog.create({
          data: {
            tenantId: session.user.tenantId,
            userId: session.user.id,
            action: "draft.send_failed",
            payloadJson: {
              conversationId: approval.conversationId,
              draftId: draft.id,
              error: sendError,
            },
          },
        })
      }
    }
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

  return NextResponse.json({ ok: true, approval: updated, ...(sendError ? { sendError } : {}) })
}
