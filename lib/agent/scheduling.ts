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

// --- Confirmation detection (deterministic, no LLM) -----------------------
//
// Runs against the inbound reply on a session that is `proposing`. A match
// means "the counterparty agreed to one specific proposed slot" — anything
// ambiguous returns null and the session stays in `proposing` for the user
// to resolve manually. False negatives are cheap (the panel still works);
// false positives would book real calendar events, so precision wins.

const DECLINE_PATTERNS = [
  /\b(doesn'?t|does not|won'?t|will not|wouldn'?t) work\b/i,
  /\b(can'?t|cannot|can not|unable to) (make|do|attend)\b/i,
  /\bnot (available|free|going to work)\b/i,
  /\bnone of (these|those|them)\b/i,
  /\b(reschedule|rain ?check)\b/i,
  /\b(a|any) (different|another|other) (time|day|slot)\b/i,
  /\bhow about\b/i,
  /\bwhat about\b/i,
  /\binstead\b/i,
  /\bneither\b/i,
]

const AFFIRMATIVE_PATTERNS = [
  /\bworks (for|great|fine|well|perfectly)\b/i,
  /\b(that|this|it) works\b/i,
  /\bsounds (good|great|perfect|fine)\b/i,
  /\blet'?s (do|go with|lock in)\b/i,
  /\b(i'?ll|i will|i can) (take|do|make)\b/i,
  /\bsee you (then|there|at|on)\b/i,
  /\bconfirm(ed|ing)?\b/i,
  /\bbook it\b/i,
  /\bperfect\b/i,
  /\bworks\b/i,
  /^\s*(yes|yep|yeah|sure|ok(ay)?|great)\b/i,
]

const ORDINAL_WORDS = ["first", "second", "third", "fourth", "fifth"]

/**
 * Strips quoted reply history so patterns only run against what the sender
 * actually wrote: everything from a "On ... wrote:" attribution line or the
 * first ">"-quoted line onward is dropped.
 */
export function stripQuotedReply(body: string): string {
  const lines = body.split(/\r?\n/)
  const cut = lines.findIndex(
    (line) => /^\s*>/.test(line) || /^On .{0,200}wrote:\s*$/.test(line.trim())
  )
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n")
}

function slotMentionIndex(text: string, slots: ProposedSlot[]): number | null {
  // Explicit ordinal / option references: "the second one", "option 2", "slot 1"
  const optionMatch = text.match(/\b(?:option|slot|time|#)\s*([1-5])\b/i)
  if (optionMatch) {
    const idx = Number(optionMatch[1]) - 1
    return idx < slots.length ? idx : null
  }
  for (let i = 0; i < Math.min(slots.length, ORDINAL_WORDS.length); i++) {
    if (new RegExp(`\\b${ORDINAL_WORDS[i]}( one| option| slot| time)?\\b`, "i").test(text)) {
      return i
    }
  }

  // Weekday (and, when needed, time) references matched against the slot
  // labels the counterparty was actually sent (e.g. "Monday, Jun 15 at 9:00 AM").
  const matches: number[] = []
  for (let i = 0; i < slots.length; i++) {
    const labelParts = slots[i].label.match(/[A-Za-z]+|\d+(?::\d+)?/g) ?? []
    const weekday = labelParts.find((p) =>
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i.test(p)
    )
    if (weekday && new RegExp(`\\b${weekday}\\b`, "i").test(text)) matches.push(i)
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    // Same weekday appears in several slots — require a time mention to pick one.
    const timed = matches.filter((i) => {
      const time = slots[i].label.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)?.[0]
      if (!time) return false
      const [, hm, ampm] = time.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i) ?? []
      const hour = hm?.split(":")[0]
      return new RegExp(`\\b${hm}\\s*${ampm}?\\b|\\b${hour}\\s*${ampm}\\b`, "i").test(text)
    })
    if (timed.length === 1) return timed[0]
  }
  return null
}

/**
 * Detects whether an inbound reply confirms one of the proposed slots.
 * Returns the agreed slot, or null when there is no unambiguous confirmation.
 */
export function detectSchedulingConfirmation(
  body: string,
  proposedSlots: ProposedSlot[]
): ProposedSlot | null {
  if (proposedSlots.length === 0) return null
  const text = stripQuotedReply(body)

  if (DECLINE_PATTERNS.some((p) => p.test(text))) return null
  if (!AFFIRMATIVE_PATTERNS.some((p) => p.test(text))) return null

  const mentioned = slotMentionIndex(text, proposedSlots)
  if (mentioned !== null) return proposedSlots[mentioned]

  // A bare affirmative only confirms when there is exactly one slot on the
  // table — with several, guessing which one the sender meant is unsafe.
  return proposedSlots.length === 1 ? proposedSlots[0] : null
}

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

