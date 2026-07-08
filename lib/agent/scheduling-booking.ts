import type { Prisma, SchedulingSession } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { getCalendarClient, createCalendarEvent, extractEmail } from "@/lib/google"
import { confirmCalendarHold, cancelCalendarHold } from "@/lib/agent/calendar-hold"
import { getAutomationLevel, isActionAllowedAtLevel } from "@/lib/agent/automation-level"
import { detectSchedulingConfirmation, type ProposedSlot } from "@/lib/agent/scheduling"

/**
 * Closes the scheduling loop: a session that reached an agreed time becomes a
 * real Google Calendar event.
 *
 * Trust ladder: booking sends an invite to the counterparty, so a
 * confirmation detected in an inbound reply auto-books only at automation
 * Level 5 (`auto_book_event`). Below that it raises a pending
 * ApprovalRequest (step "book_event") — the existing unified approval
 * primitive — and books when the user approves. User-initiated booking (the
 * panel button, including retry after a failure) is never level-gated.
 *
 * Failure handling: a calendar API failure never strands the session — the
 * session stays `confirmed`, the error is recorded on
 * `lastBookingError`/`lastBookingAttemptAt`, audited
 * (`scheduling_session.booking_failed`), surfaced in the Scheduling panel,
 * and retryable from there.
 */

export const APPROVAL_STEP_BOOK_EVENT = "book_event"

const DEFAULT_SLOT_MINUTES = 30

export type BookingTrigger = "auto" | "approval" | "user"

export type BookSchedulingSessionResult =
  | { ok: true; session: SchedulingSession; alreadyBooked?: boolean }
  | { ok: false; error: string; session: SchedulingSession | null }

function proposedSlots(session: SchedulingSession): ProposedSlot[] {
  const raw = session.proposedTimesJson
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is ProposedSlot =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as ProposedSlot).start === "string" &&
      typeof (s as ProposedSlot).end === "string"
  )
}

/**
 * Ensures a single pending book_event ApprovalRequest exists for a session.
 * Idempotent across repeated syncs of the same inbound reply.
 */
export async function ensureBookingApprovalRequest(input: {
  tenantId: string
  conversationId: string
  sessionId: string
  slot: ProposedSlot
  calendarEmail: string | null
}) {
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      step: APPROVAL_STEP_BOOK_EVENT,
      status: "pending",
    },
  })
  if (existing) return existing

  const approval = await prisma.approvalRequest.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      step: APPROVAL_STEP_BOOK_EVENT,
      metadataJson: {
        source: "scheduling",
        sessionId: input.sessionId,
        start: input.slot.start,
        end: input.slot.end,
        label: input.slot.label,
        calendarEmail: input.calendarEmail,
      } as Prisma.InputJsonValue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "scheduling_session.booking_approval_requested",
      payloadJson: {
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        approvalRequestId: approval.id,
        start: input.slot.start,
        end: input.slot.end,
        label: input.slot.label,
      },
    },
  })

  return approval
}

/**
 * Books the real calendar event for a confirmed scheduling session. Converts
 * an active calendar hold at the same time instead of creating a duplicate
 * event; a stale hold at a different time is cancelled (its tentative event
 * is deleted) before the real event is created.
 */
export async function bookSchedulingSession(input: {
  tenantId: string
  conversationId: string
  trigger: BookingTrigger
  actorUserId?: string | null
}): Promise<BookSchedulingSessionResult> {
  const session = await prisma.schedulingSession.findFirst({
    where: { conversationId: input.conversationId, tenantId: input.tenantId },
  })
  if (!session) return { ok: false, error: "No scheduling session for this conversation", session: null }
  if (session.status === "booked" && session.eventId) {
    return { ok: true, session, alreadyBooked: true }
  }
  if (!session.confirmedTime) {
    return { ok: false, error: "No confirmed time on this scheduling session", session }
  }

  const start = new Date(session.confirmedTime)
  if (isNaN(start.getTime())) {
    return { ok: false, error: "Confirmed time is not a valid date", session }
  }
  const matchedSlot = proposedSlots(session).find((s) => s.start === session.confirmedTime)
  const end = matchedSlot
    ? new Date(matchedSlot.end)
    : new Date(start.getTime() + DEFAULT_SLOT_MINUTES * 60 * 1000)

  let calendarEmail = session.calendarEmail
  if (!calendarEmail) {
    const profile = await prisma.businessProfile.findUnique({
      where: { tenantId: input.tenantId },
      select: { primaryCalendarEmail: true },
    })
    calendarEmail = profile?.primaryCalendarEmail ?? null
  }

  const failBooking = async (error: string): Promise<BookSchedulingSessionResult> => {
    const updated = await prisma.schedulingSession.update({
      where: { id: session.id },
      data: { lastBookingError: error, lastBookingAttemptAt: new Date() },
    })
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorUserId ?? null,
        action: "scheduling_session.booking_failed",
        payloadJson: {
          conversationId: input.conversationId,
          sessionId: session.id,
          error,
          trigger: input.trigger,
        },
      },
    })
    return { ok: false, error, session: updated }
  }

  if (!calendarEmail) {
    return failBooking("No booking calendar configured — connect Google Calendar or set a primary booking calendar in Settings")
  }

  try {
    const [latestInbound, contact, activeHold] = await Promise.all([
      prisma.message.findFirst({
        where: { conversationId: input.conversationId, direction: "inbound" },
        orderBy: { createdAt: "desc" },
        select: { subject: true, fromE164: true },
      }),
      prisma.conversation
        .findFirst({
          where: { id: input.conversationId, tenantId: input.tenantId },
          select: { contact: { select: { name: true } } },
        })
        .then((c) => c?.contact ?? null),
      prisma.calendarHold.findFirst({
        where: { conversationId: input.conversationId, tenantId: input.tenantId, status: "held" },
        orderBy: { createdAt: "desc" },
      }),
    ])

    const counterpartyEmail = latestInbound?.fromE164 ? extractEmail(latestInbound.fromE164) : null
    const summary = contact?.name
      ? `Meeting with ${contact.name}`
      : latestInbound?.subject?.trim()
        ? `Meeting: ${latestInbound.subject.trim()}`
        : "Meeting (via FlowDesk)"

    let eventId: string
    let holdConverted = false

    if (activeHold && activeHold.startAt.getTime() === start.getTime()) {
      // The agreed time already has a tentative hold — convert it in place
      // (confirmCalendarHold patches the event to confirmed and audits).
      await confirmCalendarHold(activeHold.id, input.tenantId)
      eventId = activeHold.externalEventId
      holdConverted = true
    } else {
      if (activeHold) {
        // Stale hold at a different time: release it so the tentative event
        // doesn't linger next to the real booking. Best-effort.
        try {
          await cancelCalendarHold(activeHold.id, input.tenantId)
        } catch (err) {
          console.error("[scheduling-booking] stale hold cleanup failed:", err)
        }
      }
      const calendar = await getCalendarClient(input.tenantId, calendarEmail)
      const event = await createCalendarEvent(calendar, {
        summary,
        description: `Booked via FlowDesk scheduling (conversation ${input.conversationId})`,
        start,
        end,
        status: "confirmed",
        attendeeEmails: counterpartyEmail && counterpartyEmail.includes("@") ? [counterpartyEmail] : [],
      })
      eventId = event.id
    }

    const updated = await prisma.schedulingSession.update({
      where: { id: session.id },
      data: {
        status: "booked",
        eventId,
        lastBookingError: null,
        lastBookingAttemptAt: new Date(),
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.actorUserId ?? null,
        action: "scheduling_session.booked",
        payloadJson: {
          conversationId: input.conversationId,
          sessionId: session.id,
          eventId,
          calendarEmail,
          start: start.toISOString(),
          end: end.toISOString(),
          holdConverted,
          trigger: input.trigger,
        },
      },
    })

    return { ok: true, session: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar booking failed"
    return failBooking(message)
  }
}

/**
 * Inbound-reply hook (called from work-item sync): when a `proposing` session's
 * counterparty replies agreeing to a proposed slot, confirm the session and
 * either auto-book (Level 5) or raise a book_event approval.
 */
export async function handleSchedulingConfirmationForInboundReply(input: {
  tenantId: string
  conversationId: string
  inboundBody: string
}): Promise<void> {
  const session = await prisma.schedulingSession.findFirst({
    where: { conversationId: input.conversationId, tenantId: input.tenantId, status: "proposing" },
  })
  if (!session) return

  const slots = proposedSlots(session)
  const agreed = detectSchedulingConfirmation(input.inboundBody, slots)
  if (!agreed) return

  await prisma.schedulingSession.update({
    where: { id: session.id },
    data: { status: "confirmed", confirmedTime: agreed.start },
  })
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "scheduling_session.confirmed",
      payloadJson: {
        conversationId: input.conversationId,
        sessionId: session.id,
        confirmedTime: agreed.start,
        label: agreed.label,
        detectedFrom: "inbound_reply",
      },
    },
  })

  const level = await getAutomationLevel(input.tenantId)
  if (isActionAllowedAtLevel(level, "auto_book_event")) {
    await bookSchedulingSession({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      trigger: "auto",
    })
  } else {
    await ensureBookingApprovalRequest({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sessionId: session.id,
      slot: agreed,
      calendarEmail: session.calendarEmail,
    })
  }
}
