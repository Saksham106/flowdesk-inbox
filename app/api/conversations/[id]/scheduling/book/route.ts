import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  bookSchedulingSession,
  APPROVAL_STEP_BOOK_EVENT,
} from "@/lib/agent/scheduling-booking"

export const runtime = "nodejs"

/**
 * User-initiated booking (and retry after a failed booking) for a confirmed
 * scheduling session. Never level-gated — the user clicking the button IS the
 * approval.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  const result = await bookSchedulingSession({
    tenantId,
    conversationId: params.id,
    trigger: "user",
    actorUserId: session.user.id ?? null,
  })

  if (!result.ok) {
    const status = result.session ? 502 : 404
    return NextResponse.json(
      { error: result.error, schedulingSession: result.session },
      { status }
    )
  }

  // Booking manually supersedes any pending book_event approval for this
  // conversation — cancel it so the queue never shows stale pending work.
  const cancelled = await prisma.approvalRequest.updateMany({
    where: {
      tenantId,
      conversationId: params.id,
      step: APPROVAL_STEP_BOOK_EVENT,
      status: "pending",
    },
    data: {
      status: "cancelled",
      decidedAt: new Date(),
      reviewerUserId: session.user.id ?? null,
      decisionNote: "Booked manually from the conversation panel",
    },
  })
  if (cancelled.count > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id ?? null,
        action: "approval_request.resolved",
        payloadJson: {
          conversationId: params.id,
          step: APPROVAL_STEP_BOOK_EVENT,
          resolution: "cancelled",
          count: cancelled.count,
          note: "Booked manually from the conversation panel",
        },
      },
    })
  }

  return NextResponse.json({ schedulingSession: result.session })
}
