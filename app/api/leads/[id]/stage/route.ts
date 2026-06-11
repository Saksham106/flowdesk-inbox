import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const ALLOWED_STAGES = ["new", "contacted", "qualified", "won", "lost"] as const
type LeadStage = (typeof ALLOWED_STAGES)[number]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const stage = body?.stage as string | undefined
  const nextAction = body?.nextAction as string | undefined

  if (!stage || !ALLOWED_STAGES.includes(stage as LeadStage)) {
    return NextResponse.json(
      { error: "stage must be one of: new, contacted, qualified, won, lost" },
      { status: 400 }
    )
  }

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage,
      ...(nextAction !== undefined ? { nextAction } : {}),
    },
    select: {
      id: true,
      name: true,
      company: true,
      stage: true,
      score: true,
      urgency: true,
      nextAction: true,
      conversationId: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "lead.stage_changed",
      payloadJson: {
        leadId: lead.id,
        conversationId: lead.conversationId,
        from: lead.stage,
        to: stage,
      },
    },
  })

  return NextResponse.json({ ok: true, lead: updated })
}
