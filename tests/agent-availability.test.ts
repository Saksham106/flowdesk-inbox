import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetCalendarClient, mockGetFreeBusy } = vi.hoisted(() => ({
  mockGetCalendarClient: vi.fn(),
  mockGetFreeBusy:       vi.fn(),
}))

vi.mock('@/lib/google', () => ({
  getCalendarClient: mockGetCalendarClient,
  getFreeBusy:       mockGetFreeBusy,
}))

import { checkAvailability, formatSlots } from '@/lib/agent/availability'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT   = 'tenant-1'
const CAL      = 'biz@example.com'
const TIMEZONE = 'America/New_York'
const DURATION = 60

function nextMonday9am(): Date {
  const d = new Date()
  // Advance to next Monday
  const day = d.getDay()
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCalendarClient.mockResolvedValue({})
  })

  it('returns up to 5 slots when there are no busy blocks', async () => {
    mockGetFreeBusy.mockResolvedValue([])

    const slots = await checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })

    expect(slots.length).toBeGreaterThan(0)
    expect(slots.length).toBeLessThanOrEqual(5)
  })

  it('returns empty array when every business-hour slot is busy', async () => {
    // Busy for the entire look-ahead period
    const now = new Date()
    const far = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)
    mockGetFreeBusy.mockResolvedValue([{ start: now, end: far }])

    const slots = await checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })

    expect(slots).toHaveLength(0)
  })

  it('excludes slots that overlap with a busy block', async () => {
    mockGetFreeBusy.mockResolvedValue([])
    const allSlots = await checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })

    if (allSlots.length > 0) {
      const busySlot = allSlots[0]
      mockGetFreeBusy.mockResolvedValue([{ start: busySlot.start, end: busySlot.end }])
      const filtered = await checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })

      // The busy slot must not appear in the filtered results
      const overlap = filtered.some(
        (s) => s.start < busySlot.end && s.end > busySlot.start
      )
      expect(overlap).toBe(false)
    }
  })

  it('does not return slots outside business hours', async () => {
    mockGetFreeBusy.mockResolvedValue([])
    const slots = await checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })

    for (const slot of slots) {
      const startHour = new Date(slot.start).toLocaleString('en-US', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        hour12: false,
      })
      const h = parseInt(startHour)
      expect(h).toBeGreaterThanOrEqual(9)
      expect(h).toBeLessThan(17)
    }
  })

  it('throws when getCalendarClient fails (no credential)', async () => {
    mockGetCalendarClient.mockRejectedValue(new Error('No Google Calendar credential found'))

    await expect(
      checkAvailability(TENANT, CAL, { durationMinutes: DURATION, timezone: TIMEZONE })
    ).rejects.toThrow('No Google Calendar credential found')
  })
})

// ---------------------------------------------------------------------------
// formatSlots
// ---------------------------------------------------------------------------

describe('formatSlots', () => {
  it('returns human-readable strings for each slot', () => {
    const monday = nextMonday9am()
    const slots = [{ start: monday, end: new Date(monday.getTime() + 60 * 60 * 1000) }]

    const formatted = formatSlots(slots, TIMEZONE)

    expect(formatted).toHaveLength(1)
    expect(typeof formatted[0]).toBe('string')
    expect(formatted[0].length).toBeGreaterThan(5)
  })

  it('returns empty array for empty input', () => {
    expect(formatSlots([], TIMEZONE)).toEqual([])
  })

  it('formats in the requested timezone', () => {
    const monday = nextMonday9am()
    const slots = [{ start: monday, end: new Date(monday.getTime() + 60 * 60 * 1000) }]

    const eastern  = formatSlots(slots, 'America/New_York')
    const pacific  = formatSlots(slots, 'America/Los_Angeles')

    // Same moment in time should produce different clock strings
    expect(eastern).not.toEqual(pacific)
  })
})
