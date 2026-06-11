import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockLeadFindMany,
  mockLeadUpdate,
  mockJobFindFirst,
  mockJobCreate,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockLeadFindMany: vi.fn(),
  mockLeadUpdate:   vi.fn(),
  mockJobFindFirst: vi.fn(),
  mockJobCreate:    vi.fn(),
  mockAuditCreate:  vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead:     { findMany: mockLeadFindMany, update: mockLeadUpdate },
    agentJob: { findFirst: mockJobFindFirst, create: mockJobCreate },
    auditLog: { create: mockAuditCreate },
  },
}))

import {
  LEAD_SEQUENCE_STEPS,
  readSequenceState,
  getNextSequenceStep,
  runLeadSequenceBatch,
} from '@/lib/agent/lead-sequence'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1'
const NOW = new Date('2026-06-11T12:00:00Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    tenantId: TENANT,
    conversationId: 'conv-1',
    stage: 'new',
    metadataJson: null,
    conversation: {
      id: 'conv-1',
      status: 'in_progress',
      lastMessageAt: daysAgo(3),
      messages: [{ direction: 'outbound' }],
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// readSequenceState
// ---------------------------------------------------------------------------

describe('readSequenceState', () => {
  it('returns zero state for null metadata', () => {
    expect(readSequenceState(null)).toEqual({ lastStep: 0, lastStepAt: null })
  })

  it('returns zero state for metadata without a sequence', () => {
    expect(readSequenceState({ other: true })).toEqual({ lastStep: 0, lastStepAt: null })
  })

  it('parses stored sequence state', () => {
    const state = readSequenceState({
      followUpSequence: { lastStep: 2, lastStepAt: '2026-06-09T00:00:00.000Z' },
    })
    expect(state.lastStep).toBe(2)
    expect(state.lastStepAt?.toISOString()).toBe('2026-06-09T00:00:00.000Z')
  })

  it('ignores malformed lastStepAt', () => {
    const state = readSequenceState({
      followUpSequence: { lastStep: 1, lastStepAt: 'not-a-date' },
    })
    expect(state).toEqual({ lastStep: 1, lastStepAt: null })
  })
})

// ---------------------------------------------------------------------------
// getNextSequenceStep
// ---------------------------------------------------------------------------

describe('getNextSequenceStep', () => {
  const base = {
    stage: 'new',
    lastStep: 0,
    lastStepAt: null,
    lastMessageAt: daysAgo(3),
    lastMessageDirection: 'outbound',
    now: NOW,
  }

  it('returns the first step when quiet long enough', () => {
    const next = getNextSequenceStep(base)
    expect(next?.step).toBe(1)
    expect(next?.name).toBe('first_follow_up')
  })

  it('returns null before the first step is due', () => {
    expect(getNextSequenceStep({ ...base, lastMessageAt: daysAgo(1) })).toBeNull()
  })

  it('returns null when the lead replied (inbound last message)', () => {
    expect(getNextSequenceStep({ ...base, lastMessageDirection: 'inbound' })).toBeNull()
  })

  it('returns null for won and lost stages', () => {
    expect(getNextSequenceStep({ ...base, stage: 'won' })).toBeNull()
    expect(getNextSequenceStep({ ...base, stage: 'lost' })).toBeNull()
  })

  it('anchors the second step on the previous step time', () => {
    const input = {
      ...base,
      lastStep: 1,
      lastStepAt: daysAgo(2),
      lastMessageAt: daysAgo(10),
    }
    // Second step needs 4 quiet days after step one; only 2 have passed.
    expect(getNextSequenceStep(input)).toBeNull()
    expect(
      getNextSequenceStep({ ...input, lastStepAt: daysAgo(5) })?.step
    ).toBe(2)
  })

  it('returns null after the final step', () => {
    expect(
      getNextSequenceStep({
        ...base,
        lastStep: LEAD_SEQUENCE_STEPS.length,
        lastStepAt: daysAgo(30),
        lastMessageAt: daysAgo(30),
      })
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// runLeadSequenceBatch
// ---------------------------------------------------------------------------

describe('runLeadSequenceBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobFindFirst.mockResolvedValue(null)
    mockJobCreate.mockResolvedValue({ id: 'job-1' })
    mockLeadUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it('queues a job, updates sequence state, and writes an audit log', async () => {
    mockLeadFindMany.mockResolvedValue([makeLead()])

    const result = await runLeadSequenceBatch(TENANT)

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 })
    expect(mockJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        conversationId: 'conv-1',
        trigger: 'lead_follow_up',
        slotsJson: expect.objectContaining({ leadId: 'lead-1', step: 1 }),
      }),
    })
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        metadataJson: expect.objectContaining({
          followUpSequence: expect.objectContaining({ lastStep: 1 }),
        }),
      },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'lead_sequence.step_queued' }),
    })
  })

  it('skips leads on closed conversations', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead({ conversation: { id: 'conv-1', status: 'closed', lastMessageAt: daysAgo(5), messages: [{ direction: 'outbound' }] } }),
    ])

    const result = await runLeadSequenceBatch(TENANT)

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 })
    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('skips leads with a recent lead_follow_up job', async () => {
    mockLeadFindMany.mockResolvedValue([makeLead()])
    mockJobFindFirst.mockResolvedValue({ id: 'existing-job' })

    const result = await runLeadSequenceBatch(TENANT)

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 })
    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('skips leads where no step is due', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead({
        conversation: {
          id: 'conv-1',
          status: 'in_progress',
          lastMessageAt: new Date(),
          messages: [{ direction: 'outbound' }],
        },
      }),
    ])

    const result = await runLeadSequenceBatch(TENANT)

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 })
  })

  it('preserves existing metadata when recording sequence state', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead({ metadataJson: { signals: ['pricing'] } }),
    ])

    await runLeadSequenceBatch(TENANT)

    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        metadataJson: expect.objectContaining({
          signals: ['pricing'],
          followUpSequence: expect.objectContaining({ lastStep: 1 }),
        }),
      },
    })
  })

  it('counts failures without aborting the batch', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead(),
      makeLead({ id: 'lead-2', conversationId: 'conv-2', conversation: { id: 'conv-2', status: 'in_progress', lastMessageAt: daysAgo(3), messages: [{ direction: 'outbound' }] } }),
    ])
    mockJobCreate
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'job-2' })

    const result = await runLeadSequenceBatch(TENANT)

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 1 })
  })
})
