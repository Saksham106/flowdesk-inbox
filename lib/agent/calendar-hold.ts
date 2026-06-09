import { prisma } from "@/lib/prisma"
import {
  getCalendarClient,
  createCalendarEvent,
  deleteCalendarEvent,
  patchCalendarEventStatus,
} from "@/lib/google"
import type { CalendarHold } from "@prisma/client"

const HOLD_EXPIRY_HOURS = 48

export type CreateCalendarHoldInput = {
  conversationId: string
  calendarEmail: string
  start: Date
  end: Date
}

export async function createCalendarHold(
  tenantId: string,
  input: CreateCalendarHoldInput
): Promise<CalendarHold> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId },
  })
  if (!conversation) {
    throw new Error("Conversation not found or does not belong to this tenant")
  }

  const calendar = await getCalendarClient(tenantId, input.calendarEmail)
  const event = await createCalendarEvent(calendar, {
    summary: "Appointment hold",
    description: `Tentative hold via FlowDesk (conversation ${input.conversationId})`,
    start: input.start,
    end: input.end,
    status: "tentative",
  })

  const expiresAt = new Date(Date.now() + HOLD_EXPIRY_HOURS * 60 * 60 * 1000)

  const hold = await prisma.calendarHold.create({
    data: {
      tenantId,
      conversationId: input.conversationId,
      calendarEmail: input.calendarEmail,
      externalEventId: event.id,
      startAt: input.start,
      endAt: input.end,
      expiresAt,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "calendar_hold.created",
      payloadJson: {
        holdId: hold.id,
        conversationId: input.conversationId,
        calendarEmail: input.calendarEmail,
        startAt: input.start.toISOString(),
        endAt: input.end.toISOString(),
        expiresAt: expiresAt.toISOString(),
        externalEventId: event.id,
      },
    },
  })

  return hold
}

export async function cancelCalendarHold(holdId: string, tenantId: string): Promise<void> {
  const hold = await prisma.calendarHold.findFirst({
    where: { id: holdId, tenantId, status: "held" },
  })
  if (!hold) {
    throw new Error("Hold not found, already cancelled, or does not belong to this tenant")
  }

  try {
    const calendar = await getCalendarClient(tenantId, hold.calendarEmail)
    await deleteCalendarEvent(calendar, hold.externalEventId)
  } catch {
    // Best-effort — DB update proceeds even if calendar deletion fails
  }

  await prisma.calendarHold.update({
    where: { id: holdId },
    data: { status: "cancelled" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "calendar_hold.cancelled",
      payloadJson: { holdId, conversationId: hold.conversationId },
    },
  })
}

export async function confirmCalendarHold(
  holdId: string,
  tenantId: string
): Promise<CalendarHold> {
  const hold = await prisma.calendarHold.findFirst({
    where: { id: holdId, tenantId, status: "held" },
  })
  if (!hold) {
    throw new Error("Hold not found, not in held state, or does not belong to this tenant")
  }

  try {
    const calendar = await getCalendarClient(tenantId, hold.calendarEmail)
    await patchCalendarEventStatus(calendar, hold.externalEventId, "confirmed", "Appointment (confirmed)")
  } catch {
    // Best-effort
  }

  const updated = await prisma.calendarHold.update({
    where: { id: holdId },
    data: { status: "confirmed" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "calendar_hold.confirmed",
      payloadJson: {
        holdId,
        conversationId: hold.conversationId,
        externalEventId: hold.externalEventId,
      },
    },
  })

  return updated
}

export async function expireStaleHolds(): Promise<number> {
  const stale = await prisma.calendarHold.findMany({
    where: { status: "held", expiresAt: { lt: new Date() } },
  })

  let count = 0
  for (const hold of stale) {
    try {
      const calendar = await getCalendarClient(hold.tenantId, hold.calendarEmail)
      await deleteCalendarEvent(calendar, hold.externalEventId)
    } catch {
      // Best-effort
    }

    await prisma.calendarHold.update({
      where: { id: hold.id },
      data: { status: "expired" },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: hold.tenantId,
        action: "calendar_hold.expired",
        payloadJson: { holdId: hold.id, conversationId: hold.conversationId },
      },
    })

    count++
  }

  return count
}
