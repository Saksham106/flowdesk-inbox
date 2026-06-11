// app/api/leads/[id]/score/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"

export const runtime = "nodejs"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  await scoreLeadForConversation(session.user.tenantId, lead.id, { force: true })

  const updated = await prisma.lead.findFirst({
    where: { id: lead.id },
    select: { score: true, scoreExplanation: true, estimatedValue: true, scoredAt: true },
  })

  return NextResponse.json(updated)
}
