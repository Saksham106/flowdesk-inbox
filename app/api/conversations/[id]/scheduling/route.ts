import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { proposeSchedulingSlots } from "@/lib/agent/scheduling"
import type { Prisma } from "@prisma/client"

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const schedulingSession = await prisma.schedulingSession.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId },
  })
  return NextResponse.json({ schedulingSession })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  // Tenant isolation — verify the conversation belongs to this tenant
  const convo = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { calendarEmail } = await request.json()

  const slots = calendarEmail
    ? await proposeSchedulingSlots(tenantId, calendarEmail)
    : []

  const schedulingSession = await prisma.schedulingSession.upsert({
    where: { conversationId: params.id },
    update: {
      status: slots.length > 0 ? "proposing" : "detecting",
      ...(slots.length > 0 ? { proposedTimesJson: slots as Prisma.InputJsonValue } : {}),
      ...(calendarEmail ? { calendarEmail } : {}),
    },
    create: {
      tenantId,
      conversationId: params.id,
      status: slots.length > 0 ? "proposing" : "detecting",
      proposedTimesJson: slots as Prisma.InputJsonValue,
      calendarEmail: calendarEmail ?? null,
    },
  })

  return NextResponse.json({ schedulingSession, slots })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const existing = await prisma.schedulingSession.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json()

  const updated = await prisma.schedulingSession.update({
    where: { conversationId: params.id },
    data: {
      ...(body.confirmedTime && { confirmedTime: body.confirmedTime, status: "confirmed" }),
      ...(body.eventId && { eventId: body.eventId, status: "booked" }),
      ...(body.status && !body.confirmedTime && !body.eventId && { status: body.status }),
    },
  })
  return NextResponse.json({ schedulingSession: updated })
}
