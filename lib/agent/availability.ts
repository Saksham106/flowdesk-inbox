import { getCalendarClient, getFreeBusy } from "@/lib/google"

export type AvailableSlot = {
  start: Date
  end: Date
}

type BusinessHours = {
  [day: string]: { open: string; close: string } | null
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

export async function checkAvailability(
  tenantId: string,
  calendarEmail: string,
  {
    durationMinutes = 60,
    timezone = "America/New_York",
    businessHoursJson,
    lookAheadDays = 7,
  }: {
    durationMinutes?: number
    timezone?: string
    businessHoursJson?: unknown
    lookAheadDays?: number
  } = {}
): Promise<AvailableSlot[]> {
  const calendar = await getCalendarClient(tenantId, calendarEmail)

  const rangeStart = startOfNextHour()
  const rangeEnd = new Date(rangeStart.getTime() + lookAheadDays * 24 * 60 * 60 * 1000)

  const busyBlocks = await getFreeBusy(calendar, { start: rangeStart, end: rangeEnd })
  const hours = parseBusinessHours(businessHoursJson)

  const candidates = generateCandidateSlots(rangeStart, rangeEnd, durationMinutes, timezone, hours)
  const available = candidates.filter((slot) => !overlapsAnyBusy(slot, busyBlocks))

  return available.slice(0, 5)
}

export function formatSlots(slots: AvailableSlot[], timezone: string): string[] {
  return slots.map((slot) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    return formatter.format(slot.start)
  })
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function startOfNextHour(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

function generateCandidateSlots(
  rangeStart: Date,
  rangeEnd: Date,
  durationMinutes: number,
  timezone: string,
  hours: BusinessHours
): AvailableSlot[] {
  const slots: AvailableSlot[] = []
  const stepMs = durationMinutes * 60 * 1000
  const current = new Date(rangeStart)

  while (current < rangeEnd) {
    const end = new Date(current.getTime() + stepMs)
    if (isWithinBusinessHours(current, end, timezone, hours)) {
      slots.push({ start: new Date(current), end })
    }
    current.setTime(current.getTime() + stepMs)
  }

  return slots
}

function isWithinBusinessHours(
  start: Date,
  end: Date,
  timezone: string,
  hours: BusinessHours
): boolean {
  const dayName = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" })
    .format(start)
    .toLowerCase()

  const rule = hours[dayName]
  if (rule === null || rule === undefined) return false

  const openH = parseHour(rule.open ?? "09:00")
  const closeH = parseHour(rule.close ?? "17:00")

  const startH = localHour(start, timezone)
  const endH = localHour(end, timezone)
  const sameLocalDay = localDateKey(start, timezone) === localDateKey(end, timezone)

  return sameLocalDay && endH > startH && startH >= openH && endH <= closeH
}

function localHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date)

  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0")
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0")
  return h + m / 60
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)

  const year = parts.find((p) => p.type === "year")?.value ?? "0000"
  const month = parts.find((p) => p.type === "month")?.value ?? "00"
  const day = parts.find((p) => p.type === "day")?.value ?? "00"
  return `${year}-${month}-${day}`
}

function parseHour(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return (h ?? 0) + (m ?? 0) / 60
}

function parseBusinessHours(raw: unknown): BusinessHours {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as BusinessHours
  }
  // Default: Mon–Fri 9am–5pm
  return Object.fromEntries(
    DAY_NAMES.map((day) =>
      ["saturday", "sunday"].includes(day)
        ? [day, null]
        : [day, { open: "09:00", close: "17:00" }]
    )
  )
}

function overlapsAnyBusy(
  slot: AvailableSlot,
  busy: Array<{ start: Date; end: Date }>
): boolean {
  return busy.some((b) => slot.start < b.end && slot.end > b.start)
}
