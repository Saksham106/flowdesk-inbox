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
  mockConvUpdate,
  mockJobUpdateMany,
  mockStateFindUnique,
  mockStateUpdate,
  mockWritebackFindMany,
  mockProjectLabels,
} = vi.hoisted(() => ({
  mockFollowUpSettingFindMany: vi.fn(),
  mockConvFindMany:            vi.fn(),
  mockJobFindFirst:            vi.fn(),
  mockJobCount:                vi.fn(),
  mockJobCreate:               vi.fn(),
  mockAuditCreate:             vi.fn(),
  mockConvUpdate:              vi.fn(),
  mockJobUpdateMany:           vi.fn(),
  mockStateFindUnique:         vi.fn(),
  mockStateUpdate:             vi.fn(),
  mockWritebackFindMany:       vi.fn(),
  mockProjectLabels:           vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    followUpSetting:    { findMany: mockFollowUpSettingFindMany },
    conversation:       { findMany: mockConvFindMany, update: mockConvUpdate },
    conversationState:  { findUnique: mockStateFindUnique, update: mockStateUpdate },
    agentJob:           { findFirst: mockJobFindFirst, count: mockJobCount, create: mockJobCreate, updateMany: mockJobUpdateMany },
    auditLog:           { create: mockAuditCreate },
    emailWritebackQueue: { findMany: mockWritebackFindMany },
  },
}))

vi.mock('@/lib/email-labels', () => ({
  projectFlowDeskLabelsForConversation: mockProjectLabels,
}))

import {
  addBusinessDays,
  clearWaitingOnForInboundReply,
  followUpDueAt,
  getStaleConversations,
  hasRecentFollowUpJob,
  markConversationWaitingOn,
  outboundMessageExpectsReply,
  runFollowUpBatch,
  runFollowUpLabelSweep,
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
// outboundMessageExpectsReply
// ---------------------------------------------------------------------------

describe('outboundMessageExpectsReply', () => {
  it('detects questions and request phrases', () => {
    expect(outboundMessageExpectsReply('Does Tuesday at 3pm work for you?')).toBe(true)
    expect(outboundMessageExpectsReply('Let me know when the contract is signed.')).toBe(true)
    expect(outboundMessageExpectsReply('Please confirm the delivery date.')).toBe(true)
    expect(outboundMessageExpectsReply('Could you send over the invoice?')).toBe(true)
    expect(outboundMessageExpectsReply('Looking forward to hearing from you.')).toBe(true)
    expect(outboundMessageExpectsReply('Keep me posted on the rollout.')).toBe(true)
  })

  it('does not fire on closing messages with no reply expected', () => {
    expect(outboundMessageExpectsReply('Thanks so much. All set on my end.')).toBe(false)
    expect(outboundMessageExpectsReply('Sounds good, see you then!')).toBe(false)
    expect(outboundMessageExpectsReply('Received, thank you.')).toBe(false)
  })

  it('ignores question marks inside quoted reply text', () => {
    const body = [
      'All done — payment went out this morning.',
      '',
      'On Mon, Jul 6, 2026 at 9:00 AM Sarah <sarah@example.com> wrote:',
      '> Could you send the payment this week?',
    ].join('\n')
    expect(outboundMessageExpectsReply(body)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// markConversationWaitingOn
// ---------------------------------------------------------------------------

describe('markConversationWaitingOn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
  })

  it('moves the conversation to in_progress and audits the detection', async () => {
    await markConversationWaitingOn({
      tenantId: TENANT,
      conversationId: CONV_1,
      detectedFrom: 'gmail_sync',
    })

    expect(mockConvUpdate).toHaveBeenCalledWith({
      where: { id: CONV_1, tenantId: TENANT },
      data: { status: 'in_progress' },
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          action: 'conversation.waiting_on_detected',
          payloadJson: expect.objectContaining({
            conversationId: CONV_1,
            detectedFrom: 'gmail_sync',
          }),
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Business-day math
// ---------------------------------------------------------------------------

describe('addBusinessDays / followUpDueAt', () => {
  it('skips weekends', () => {
    // Thursday 2026-07-02 + 3 business days = Tuesday 2026-07-07
    const thursday = new Date('2026-07-02T10:00:00.000Z')
    expect(addBusinessDays(thursday, 3).toISOString()).toBe('2026-07-07T10:00:00.000Z')
  })

  it('adds plain days mid-week', () => {
    // Monday 2026-07-06 + 2 business days = Wednesday 2026-07-08
    const monday = new Date('2026-07-06T09:00:00.000Z')
    expect(addBusinessDays(monday, 2).toISOString()).toBe('2026-07-08T09:00:00.000Z')
  })

  it('enforces a minimum delay of one business day', () => {
    const monday = new Date('2026-07-06T09:00:00.000Z')
    expect(followUpDueAt(monday, 0).toISOString()).toBe('2026-07-07T09:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// runFollowUpLabelSweep
// ---------------------------------------------------------------------------

describe('runFollowUpLabelSweep', () => {
  const now = new Date('2026-07-06T12:00:00.000Z') // Monday
  const overdue = new Date('2026-06-29T12:00:00.000Z') // previous Monday — well past 3 business days

  beforeEach(() => {
    vi.clearAllMocks()
    mockConvFindMany.mockResolvedValue([
      { id: CONV_1, tenantId: TENANT, lastMessageAt: overdue },
    ])
    mockFollowUpSettingFindMany.mockResolvedValue([])
    mockWritebackFindMany.mockResolvedValue([])
    mockProjectLabels.mockResolvedValue({ id: 'job-1' })
    mockAuditCreate.mockResolvedValue({})
  })

  it('re-projects labels for overdue waiting-on conversations and audits', async () => {
    const result = await runFollowUpLabelSweep(now)

    expect(result).toEqual({ projected: 1, skipped: 0, failed: 0 })
    expect(mockProjectLabels).toHaveBeenCalledWith({
      tenantId: TENANT,
      conversationId: CONV_1,
    })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          action: 'follow_up.due_labeled',
          payloadJson: expect.objectContaining({
            conversationId: CONV_1,
            staleAfterBusinessDays: 3,
          }),
        }),
      })
    )
  })

  it('respects a longer tenant-configured delay', async () => {
    mockFollowUpSettingFindMany.mockResolvedValue([
      { tenantId: TENANT, staleAfterDays: 10 },
    ])

    const result = await runFollowUpLabelSweep(now)

    expect(result).toEqual({ projected: 0, skipped: 1, failed: 0 })
    expect(mockProjectLabels).not.toHaveBeenCalled()
  })

  it('skips conversations already re-projected recently', async () => {
    // The recency filter (status != failed, updatedAt within the coarse
    // window) is applied in the Prisma query itself, so a returned row means
    // "already handled recently."
    mockWritebackFindMany.mockResolvedValue([{ conversationId: CONV_1 }])

    const result = await runFollowUpLabelSweep(now)

    expect(result).toEqual({ projected: 0, skipped: 1, failed: 0 })
    expect(mockProjectLabels).not.toHaveBeenCalled()
  })

  it('re-projects conversations whose prior writeback failed or aged out', async () => {
    // A failed or stale row is filtered out by the Prisma query itself, so
    // it never comes back here — the sweep re-projects normally.
    mockWritebackFindMany.mockResolvedValue([])

    const result = await runFollowUpLabelSweep(now)

    expect(result).toEqual({ projected: 1, skipped: 0, failed: 0 })
    expect(mockProjectLabels).toHaveBeenCalledWith({
      tenantId: TENANT,
      conversationId: CONV_1,
    })
  })

  it('only sweeps waiting-on conversations on Google channels', async () => {
    await runFollowUpLabelSweep(now)

    const where = mockConvFindMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ status: 'in_progress' }, { userState: 'waiting_on' }])
    expect(where.channel).toEqual({ provider: 'google' })
  })

  it('counts projection failures without aborting the sweep', async () => {
    mockConvFindMany.mockResolvedValue([
      { id: CONV_1, tenantId: TENANT, lastMessageAt: overdue },
      { id: CONV_2, tenantId: TENANT, lastMessageAt: overdue },
    ])
    mockProjectLabels
      .mockRejectedValueOnce(new Error('gmail down'))
      .mockResolvedValueOnce({ id: 'job-2' })

    const result = await runFollowUpLabelSweep(now)

    expect(result).toEqual({ projected: 1, skipped: 0, failed: 1 })
  })
})

// ---------------------------------------------------------------------------
// clearWaitingOnForInboundReply
// ---------------------------------------------------------------------------

describe('clearWaitingOnForInboundReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConvUpdate.mockResolvedValue({})
    mockStateFindUnique.mockResolvedValue(null)
    mockStateUpdate.mockResolvedValue({})
    mockJobUpdateMany.mockResolvedValue({ count: 1 })
    mockAuditCreate.mockResolvedValue({})
  })

  it('returns the conversation to needs_reply and clears userState', async () => {
    await clearWaitingOnForInboundReply({ tenantId: TENANT, conversationId: CONV_1 })

    expect(mockConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONV_1, tenantId: TENANT },
        data: expect.objectContaining({
          userState: null,
          userStateSource: 'flowdesk_lifecycle',
          status: 'needs_reply',
        }),
      })
    )
  })

  it('cancels pending follow_up jobs for the thread', async () => {
    await clearWaitingOnForInboundReply({ tenantId: TENANT, conversationId: CONV_1 })

    expect(mockJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          conversationId: CONV_1,
          trigger: 'follow_up',
          status: 'pending',
        },
        data: expect.objectContaining({
          status: 'failed',
          error: 'cancelled_by_inbound_reply',
        }),
      })
    )
  })

  it('rewrites a stale waiting_on attention category so labels cannot resurrect', async () => {
    mockStateFindUnique.mockResolvedValue({
      attentionCategory: 'waiting_on',
      metadataJson: { attentionCategory: 'waiting_on', other: 'kept' },
    })

    await clearWaitingOnForInboundReply({ tenantId: TENANT, conversationId: CONV_1 })

    expect(mockStateUpdate).toHaveBeenCalledWith({
      where: { conversationId: CONV_1 },
      data: {
        attentionCategory: 'needs_reply',
        metadataJson: { attentionCategory: 'needs_reply', other: 'kept' },
      },
    })
  })

  it('leaves other attention categories untouched', async () => {
    mockStateFindUnique.mockResolvedValue({
      attentionCategory: 'needs_action',
      metadataJson: { attentionCategory: 'needs_action' },
    })

    await clearWaitingOnForInboundReply({ tenantId: TENANT, conversationId: CONV_1 })

    expect(mockStateUpdate).not.toHaveBeenCalled()
  })

  it('audits the transition with the cancelled job count', async () => {
    await clearWaitingOnForInboundReply({ tenantId: TENANT, conversationId: CONV_1 })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          action: 'conversation.waiting_on_cleared',
          payloadJson: expect.objectContaining({
            conversationId: CONV_1,
            reason: 'inbound_reply',
            cancelledFollowUpJobs: 1,
          }),
        }),
      })
    )
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
