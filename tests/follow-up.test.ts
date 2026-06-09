import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockFollowUpSettingFindMany,
  mockConvFindMany,
  mockJobFindFirst,
  mockJobCount,
  mockJobCreate,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockFollowUpSettingFindMany: vi.fn(),
  mockConvFindMany:            vi.fn(),
  mockJobFindFirst:            vi.fn(),
  mockJobCount:                vi.fn(),
  mockJobCreate:               vi.fn(),
  mockAuditCreate:             vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    followUpSetting: { findMany: mockFollowUpSettingFindMany },
    conversation:    { findMany: mockConvFindMany },
    agentJob:        { findFirst: mockJobFindFirst, count: mockJobCount, create: mockJobCreate },
    auditLog:        { create: mockAuditCreate },
  },
}))

import {
  getStaleConversations,
  hasRecentFollowUpJob,
  runFollowUpBatch,
} from '@/lib/agent/follow-up'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1'
const CONV_1 = 'conv-1'
const CONV_2 = 'conv-2'

const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago

const baseConv = {
  id: CONV_1,
  tenantId: TENANT,
  externalThreadId: 'thread-abc',
  lastMessageAt: staleDate,
  status: 'needs_reply',
  label: null,
  messages: [{ direction: 'inbound', createdAt: staleDate }],
}

const defaultSetting = {
  tenantId: TENANT,
  enabled: true,
  staleAfterDays: 3,
  maxFollowUpsPerConversation: 2,
}

// ---------------------------------------------------------------------------
// getStaleConversations
// ---------------------------------------------------------------------------

describe('getStaleConversations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns conversations older than threshold', async () => {
    mockConvFindMany.mockResolvedValue([baseConv])

    const result = await getStaleConversations(TENANT, 3)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(CONV_1)
    expect(result[0].lastMessageDirection).toBe('inbound')
  })

  it('passes correct tenantId to DB query', async () => {
    mockConvFindMany.mockResolvedValue([])
    await getStaleConversations(TENANT, 3)

    const where = mockConvFindMany.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT)
    expect(where.status).toEqual({ not: 'closed' })
  })

  it('returns lastMessageDirection = outbound when last message is outbound', async () => {
    mockConvFindMany.mockResolvedValue([
      { ...baseConv, messages: [{ direction: 'outbound', createdAt: staleDate }] },
    ])
    const result = await getStaleConversations(TENANT, 3)
    expect(result[0].lastMessageDirection).toBe('outbound')
  })
})

// ---------------------------------------------------------------------------
// hasRecentFollowUpJob
// ---------------------------------------------------------------------------

describe('hasRecentFollowUpJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when a recent follow_up job exists', async () => {
    mockJobFindFirst.mockResolvedValue({ id: 'job-1' })
    const result = await hasRecentFollowUpJob(CONV_1)
    expect(result).toBe(true)
  })

  it('returns false when no recent follow_up job exists', async () => {
    mockJobFindFirst.mockResolvedValue(null)
    const result = await hasRecentFollowUpJob(CONV_1)
    expect(result).toBe(false)
  })

  it('queries by conversationId and trigger', async () => {
    mockJobFindFirst.mockResolvedValue(null)
    await hasRecentFollowUpJob(CONV_1)

    const where = mockJobFindFirst.mock.calls[0][0].where
    expect(where.conversationId).toBe(CONV_1)
    expect(where.trigger).toBe('follow_up')
  })
})

// ---------------------------------------------------------------------------
// runFollowUpBatch
// ---------------------------------------------------------------------------

describe('runFollowUpBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFollowUpSettingFindMany.mockResolvedValue([defaultSetting])
    mockConvFindMany.mockResolvedValue([baseConv])
    mockJobFindFirst.mockResolvedValue(null) // no recent job
    mockJobCount.mockResolvedValue(0)        // no prior follow-ups
    mockJobCreate.mockResolvedValue({ id: 'job-new' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('creates a follow_up job for a stale conversation', async () => {
    const result = await runFollowUpBatch()

    expect(result.processed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(mockJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          conversationId: CONV_1,
          trigger: 'follow_up',
        }),
      })
    )
  })

  it('writes an audit log for each created job', async () => {
    await runFollowUpBatch()

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          action: 'follow_up.job_created',
        }),
      })
    )
  })

  it('skips conversations with a recent follow_up job (idempotency)', async () => {
    mockJobFindFirst.mockResolvedValue({ id: 'existing-job' })

    const result = await runFollowUpBatch()

    expect(result.processed).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('skips conversations that have reached maxFollowUpsPerConversation', async () => {
    mockJobCount.mockResolvedValue(2) // already at the limit

    const result = await runFollowUpBatch()

    expect(result.skipped).toBe(1)
    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('does nothing when follow-up is disabled', async () => {
    mockFollowUpSettingFindMany.mockResolvedValue([])

    const result = await runFollowUpBatch()

    expect(result.processed).toBe(0)
    expect(mockJobCreate).not.toHaveBeenCalled()
  })

  it('limits results to the specified tenantId when provided', async () => {
    await runFollowUpBatch(TENANT)

    const where = mockFollowUpSettingFindMany.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT)
  })

  it('counts failures when job creation throws', async () => {
    mockJobCreate.mockRejectedValue(new Error('DB error'))

    const result = await runFollowUpBatch()

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(0)
  })

  it('processes multiple conversations across multiple tenants', async () => {
    const setting2 = { ...defaultSetting, tenantId: 'tenant-2' }
    mockFollowUpSettingFindMany.mockResolvedValue([defaultSetting, setting2])
    // Each tenant gets its own stale conversation in separate calls
    mockConvFindMany
      .mockResolvedValueOnce([{ ...baseConv, id: CONV_1, tenantId: TENANT }])
      .mockResolvedValueOnce([{ ...baseConv, id: CONV_2, tenantId: 'tenant-2' }])

    const result = await runFollowUpBatch()

    // Each tenant has 1 stale conversation, each gets 1 job
    expect(result.processed).toBe(2)
  })
})
