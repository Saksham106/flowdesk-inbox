import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockConvFindFirst,
  mockHoldCreate,
  mockHoldFindFirst,
  mockHoldFindMany,
  mockHoldUpdate,
  mockAuditCreate,
  mockGetCalendarClient,
  mockCreateCalendarEvent,
  mockDeleteCalendarEvent,
  mockPatchCalendarEventStatus,
} = vi.hoisted(() => ({
  mockConvFindFirst:           vi.fn(),
  mockHoldCreate:              vi.fn(),
  mockHoldFindFirst:           vi.fn(),
  mockHoldFindMany:            vi.fn(),
  mockHoldUpdate:              vi.fn(),
  mockAuditCreate:             vi.fn(),
  mockGetCalendarClient:       vi.fn(),
  mockCreateCalendarEvent:     vi.fn(),
  mockDeleteCalendarEvent:     vi.fn(),
  mockPatchCalendarEventStatus: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation:  { findFirst: mockConvFindFirst },
    calendarHold:  {
      create:     mockHoldCreate,
      findFirst:  mockHoldFindFirst,
      findMany:   mockHoldFindMany,
      update:     mockHoldUpdate,
    },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock('@/lib/google', () => ({
  getCalendarClient:        mockGetCalendarClient,
  createCalendarEvent:      mockCreateCalendarEvent,
  deleteCalendarEvent:      mockDeleteCalendarEvent,
  patchCalendarEventStatus: mockPatchCalendarEventStatus,
}))

import {
  createCalendarHold,
  cancelCalendarHold,
  confirmCalendarHold,
  expireStaleHolds,
} from '@/lib/agent/calendar-hold'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1'
const CONV   = 'conv-1'
const HOLD   = 'hold-1'
const CAL    = 'biz@example.com'
const EVENT  = 'evt-1'
const START  = new Date('2026-06-15T09:00:00Z')
const END    = new Date('2026-06-15T10:00:00Z')

const baseHold = {
  id: HOLD, tenantId: TENANT, conversationId: CONV,
  calendarEmail: CAL, externalEventId: EVENT,
  status: 'held' as const,
  startAt: START, endAt: END,
  expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
  createdAt: new Date(),
}

// ---------------------------------------------------------------------------
// createCalendarHold
// ---------------------------------------------------------------------------

describe('createCalendarHold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvFindFirst.mockResolvedValue({ id: CONV, tenantId: TENANT })
    mockGetCalendarClient.mockResolvedValue({})
    mockCreateCalendarEvent.mockResolvedValue({ id: EVENT })
    mockHoldCreate.mockResolvedValue(baseHold)
    mockAuditCreate.mockResolvedValue({})
  })

  it('creates a hold and writes an audit log', async () => {
    const hold = await createCalendarHold(TENANT, { conversationId: CONV, calendarEmail: CAL, start: START, end: END })

    expect(hold.id).toBe(HOLD)
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'tentative' })
    )
    expect(mockHoldCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, conversationId: CONV, externalEventId: EVENT }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'calendar_hold.created' }) })
    )
  })

  it('throws when conversation does not belong to tenant', async () => {
    mockConvFindFirst.mockResolvedValue(null)

    await expect(
      createCalendarHold(TENANT, { conversationId: 'other', calendarEmail: CAL, start: START, end: END })
    ).rejects.toThrow('does not belong to this tenant')

    expect(mockHoldCreate).not.toHaveBeenCalled()
  })

  it('scopes conversation lookup to tenantId', async () => {
    mockConvFindFirst.mockResolvedValue(null)
    await createCalendarHold(TENANT, { conversationId: CONV, calendarEmail: CAL, start: START, end: END }).catch(() => {})

    const where = mockConvFindFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT)
  })
})

// ---------------------------------------------------------------------------
// cancelCalendarHold
// ---------------------------------------------------------------------------

describe('cancelCalendarHold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHoldFindFirst.mockResolvedValue(baseHold)
    mockGetCalendarClient.mockResolvedValue({})
    mockDeleteCalendarEvent.mockResolvedValue(undefined)
    mockHoldUpdate.mockResolvedValue({ ...baseHold, status: 'cancelled' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('deletes the calendar event and marks the hold cancelled', async () => {
    await cancelCalendarHold(HOLD, TENANT)

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith(expect.anything(), EVENT)
    expect(mockHoldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled' } })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'calendar_hold.cancelled' }) })
    )
  })

  it('still updates DB if calendar deletion fails (best-effort)', async () => {
    mockDeleteCalendarEvent.mockRejectedValue(new Error('Calendar error'))

    await cancelCalendarHold(HOLD, TENANT)

    expect(mockHoldUpdate).toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalled()
  })

  it('throws when hold not found or already cancelled', async () => {
    mockHoldFindFirst.mockResolvedValue(null)

    await expect(cancelCalendarHold(HOLD, TENANT)).rejects.toThrow()
    expect(mockHoldUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// confirmCalendarHold
// ---------------------------------------------------------------------------

describe('confirmCalendarHold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHoldFindFirst.mockResolvedValue(baseHold)
    mockGetCalendarClient.mockResolvedValue({})
    mockPatchCalendarEventStatus.mockResolvedValue(undefined)
    mockHoldUpdate.mockResolvedValue({ ...baseHold, status: 'confirmed' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('patches the calendar event to confirmed and updates the DB', async () => {
    const updated = await confirmCalendarHold(HOLD, TENANT)

    expect(mockPatchCalendarEventStatus).toHaveBeenCalledWith(
      expect.anything(), EVENT, 'confirmed', expect.any(String)
    )
    expect(mockHoldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'confirmed' } })
    )
    expect(updated.status).toBe('confirmed')
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'calendar_hold.confirmed' }) })
    )
  })

  it('still updates DB if calendar patch fails (best-effort)', async () => {
    mockPatchCalendarEventStatus.mockRejectedValue(new Error('Calendar error'))

    const updated = await confirmCalendarHold(HOLD, TENANT)

    expect(updated.status).toBe('confirmed')
  })
})

// ---------------------------------------------------------------------------
// expireStaleHolds
// ---------------------------------------------------------------------------

describe('expireStaleHolds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCalendarClient.mockResolvedValue({})
    mockDeleteCalendarEvent.mockResolvedValue(undefined)
    mockHoldUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it('returns 0 when there are no stale holds', async () => {
    mockHoldFindMany.mockResolvedValue([])
    const count = await expireStaleHolds()
    expect(count).toBe(0)
  })

  it('expires each stale hold and writes audit logs', async () => {
    const stale = [
      { ...baseHold, id: 'h1', expiresAt: new Date(Date.now() - 1000) },
      { ...baseHold, id: 'h2', expiresAt: new Date(Date.now() - 2000) },
    ]
    mockHoldFindMany.mockResolvedValue(stale)

    const count = await expireStaleHolds()

    expect(count).toBe(2)
    expect(mockHoldUpdate).toHaveBeenCalledTimes(2)
    expect(mockAuditCreate).toHaveBeenCalledTimes(2)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'calendar_hold.expired' }) })
    )
  })

  it('continues expiring remaining holds if one calendar deletion fails', async () => {
    const stale = [
      { ...baseHold, id: 'h1', expiresAt: new Date(Date.now() - 1000) },
      { ...baseHold, id: 'h2', expiresAt: new Date(Date.now() - 2000) },
    ]
    mockHoldFindMany.mockResolvedValue(stale)
    mockDeleteCalendarEvent.mockRejectedValueOnce(new Error('Network error'))

    const count = await expireStaleHolds()

    expect(count).toBe(2)
    expect(mockHoldUpdate).toHaveBeenCalledTimes(2)
  })
})
