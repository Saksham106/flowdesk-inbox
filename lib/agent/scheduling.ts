import { getCalendarClient, listEvents } from "@/lib/google"

const SCHEDULING_PATTERNS = [
  /can we (schedule|set up|arrange|book) (a |an )?(call|meeting|chat|time|session)/i,
  /find (a |some )?time (to |for )/i,
  /are you available/i,
  /what(?:'s| is) your availability/i,
  /when (are you|would you be) (free|available)/i,
  /let(?:'s| us) (meet|chat|talk|connect|catch up)/i,
  /schedule (a |an )?(call|meeting|time)/i,
  /book (a |an )?(time|slot|call|meeting)/i,
  /hop on (a |the )?(call|zoom|meet)/i,
]

const EXCLUSION_PATTERNS = [
  /calendar invite/i,
  /you(?:'ve| have) been invited/i,
  /this is a reminder/i,
  /meeting has been (scheduled|confirmed|cancelled)/i,
]

export function detectSchedulingRequest(subject: string, body: string): boolean {
  const text = `${subject} ${body}`
  if (EXCLUSION_PATTERNS.some((p) => p.test(text))) return false
  return SCHEDULING_PATTERNS.some((p) => p.test(text))
}

export type ProposedSlot = { start: string; end: string; label: string }

export async function proposeSchedulingSlots(
  tenantId: string,
  calendarEmail: string
): Promise<ProposedSlot[]> {
  // Slot times are in UTC. Timezone conversion (using the calendar owner's configured tz) is a planned improvement.
  let calendar: Awaited<ReturnType<typeof getCalendarClient>>
  try {
    calendar = await getCalendarClient(tenantId, calendarEmail)
  } catch {
    return []
  }

  const now = new Date()
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const existing = await listEvents(calendar, { timeMin: now, timeMax: windowEnd, maxResults: 50 })

  // Build 30-min slots on business days 9am–5pm
  const slots: ProposedSlot[] = []
  const cursor = new Date(now)
  cursor.setMinutes(0, 0, 0)
  cursor.setHours(cursor.getHours() + 1) // start next hour

  while (slots.length < 3 && cursor < windowEnd) {
    const day = cursor.getDay()
    const hour = cursor.getHours()
    if (day !== 0 && day !== 6 && hour >= 9 && hour < 17) {
      const slotEnd = new Date(cursor.getTime() + 30 * 60 * 1000)
      const conflict = existing.some(
        (e) => e.start < slotEnd && e.end > cursor
      )
      if (!conflict) {
        const label = cursor.toLocaleString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString(), label })
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 30)
  }

  return slots
}

