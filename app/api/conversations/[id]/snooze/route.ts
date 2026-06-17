import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const snoozeUntil = body?.snoozeUntil
  if (!snoozeUntil || isNaN(new Date(snoozeUntil).getTime())) {
    return NextResponse.json({ error: "snoozeUntil required (ISO date string)" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const snooze = await prisma.snoozeReminder.create({
    data: {
      tenantId: session.user.tenantId,
      conversationId: params.id,
      userId: session.user.id,
      snoozeUntil: new Date(snoozeUntil),
      reason: body?.reason ?? null,
      status: "pending",
    },
  })

  // Mark conversation priority as snoozed in state
  const state = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  })
  const meta =
    state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
      ? (state.metadataJson as Record<string, unknown>)
      : {}
  await prisma.conversationState.update({
    where: { conversationId: params.id },
    data: {
      priority: "snoozed",
      metadataJson: { ...meta, snoozeReminderId: snooze.id, snoozeUntil } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ snooze })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pending = await prisma.snoozeReminder.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId, status: "pending" },
  })
  if (!pending) return NextResponse.json({ error: "No active snooze" }, { status: 404 })

  await prisma.snoozeReminder.update({ where: { id: pending.id }, data: { status: "dismissed" } })

  // Restore priority
  await prisma.conversationState.update({
    where: { conversationId: params.id },
    data: { priority: "normal" },
  })

  return NextResponse.json({ ok: true })
}
