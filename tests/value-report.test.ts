import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockDraftCount,
  mockTaskCount,
  mockLeadCount,
  mockJobCount,
  mockApprovalCount,
  mockStateCount,
  mockLeadAggregate,
  mockSnapshotUpsert,
  mockSnapshotFindMany,
} = vi.hoisted(() => ({
  mockDraftCount:       vi.fn(),
  mockTaskCount:        vi.fn(),
  mockLeadCount:        vi.fn(),
  mockJobCount:         vi.fn(),
  mockApprovalCount:    vi.fn(),
  mockStateCount:       vi.fn(),
  mockLeadAggregate:    vi.fn(),
  mockSnapshotUpsert:   vi.fn(),
  mockSnapshotFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft:             { count: mockDraftCount },
    inboxTask:         { count: mockTaskCount },
    lead:              { count: mockLeadCount, aggregate: mockLeadAggregate },
    agentJob:          { count: mockJobCount },
    approvalRequest:   { count: mockApprovalCount },
    conversationState: { count: mockStateCount },
    valueSnapshot:     { upsert: mockSnapshotUpsert, findMany: mockSnapshotFindMany },
  },
}))

import {
  getReportPeriod,
  estimateMinutesSaved,
  buildWeeklyValueReport,
  getWeekEnding,
  buildValueSnapshot,
  getWeeklyTrend,
  MINUTES_PER_DRAFT,
  MINUTES_PER_FOLLOW_UP,
  MINUTES_PER_TASK,
  MINUTES_PER_LEAD,
} from '@/lib/agent/value-report'

const TENANT = 'tenant-1'
const NOW = new Date('2026-06-11T12:00:00Z')

const zeroCounts = {
  draftsCreated: 0,
  draftsSent: 0,
  tasksExtracted: 0,
  tasksClosed: 0,
  leadsDetected: 0,
  followUpsQueued: 0,
  approvalsDecided: 0,
  conversationsTriaged: 0,
}

// ---------------------------------------------------------------------------
// getReportPeriod
// ---------------------------------------------------------------------------

describe('getReportPeriod', () => {
  it('returns a rolling 7-day window ending now', () => {
    const { start, end } = getReportPeriod(NOW)
    expect(end).toEqual(NOW)
    expect(NOW.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

// ---------------------------------------------------------------------------
// estimateMinutesSaved
// ---------------------------------------------------------------------------

describe('estimateMinutesSaved', () => {
  it('returns 0 for zero activity', () => {
    expect(estimateMinutesSaved(zeroCounts)).toBe(0)
  })

  it('weights drafts, follow-ups, tasks, and leads', () => {
    const minutes = estimateMinutesSaved({
      ...zeroCounts,
      draftsCreated: 2,
      followUpsQueued: 3,
      tasksExtracted: 4,
      leadsDetected: 1,
    })
    expect(minutes).toBe(
      2 * MINUTES_PER_DRAFT + 3 * MINUTES_PER_FOLLOW_UP + 4 * MINUTES_PER_TASK + 1 * MINUTES_PER_LEAD
    )
  })

  it('does not count sent drafts, closed tasks, approvals, or triage twice', () => {
    const minutes = estimateMinutesSaved({
      ...zeroCounts,
      draftsSent: 5,
      tasksClosed: 5,
      approvalsDecided: 5,
      conversationsTriaged: 50,
    })
    expect(minutes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildWeeklyValueReport
// ---------------------------------------------------------------------------

describe('buildWeeklyValueReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftCount.mockResolvedValue(0)
    mockTaskCount.mockResolvedValue(0)
    mockLeadCount.mockResolvedValue(0)
    mockJobCount.mockResolvedValue(0)
    mockApprovalCount.mockResolvedValue(0)
    mockStateCount.mockResolvedValue(0)
  })

  it('assembles counts and estimate for the period', async () => {
    mockDraftCount.mockResolvedValueOnce(6).mockResolvedValueOnce(2)
    mockTaskCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    mockLeadCount.mockResolvedValue(2)
    mockJobCount.mockResolvedValue(4)
    mockApprovalCount.mockResolvedValue(5)
    mockStateCount.mockResolvedValue(40)

    const report = await buildWeeklyValueReport(TENANT, NOW)

    expect(report.draftsCreated).toBe(6)
    expect(report.draftsSent).toBe(2)
    expect(report.tasksExtracted).toBe(3)
    expect(report.tasksClosed).toBe(1)
    expect(report.leadsDetected).toBe(2)
    expect(report.followUpsQueued).toBe(4)
    expect(report.approvalsDecided).toBe(5)
    expect(report.conversationsTriaged).toBe(40)
    expect(report.periodEnd).toEqual(NOW)
    expect(report.estimatedMinutesSaved).toBe(
      6 * MINUTES_PER_DRAFT + 4 * MINUTES_PER_FOLLOW_UP + 3 * MINUTES_PER_TASK + 2 * MINUTES_PER_LEAD
    )
  })

  it('scopes draft counts through the conversation tenant', async () => {
    await buildWeeklyValueReport(TENANT, NOW)

    expect(mockDraftCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversation: { tenantId: TENANT } }),
      })
    )
  })

  it('scopes direct models by tenantId and time window', async () => {
    await buildWeeklyValueReport(TENANT, NOW)

    const { start } = getReportPeriod(NOW)
    expect(mockTaskCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          createdAt: { gte: start, lt: NOW },
        }),
      })
    )
    expect(mockJobCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          trigger: { in: ['follow_up', 'lead_follow_up'] },
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// getWeekEnding
// ---------------------------------------------------------------------------

describe('getWeekEnding', () => {
  it('returns the following Sunday at UTC midnight for a mid-week date', () => {
    // 2026-06-11 is a Thursday
    const result = getWeekEnding(new Date('2026-06-11T14:00:00Z'))
    expect(result.toISOString()).toBe('2026-06-14T00:00:00.000Z') // Sunday
  })

  it('returns the same day at UTC midnight when today is Sunday', () => {
    // 2026-06-14 is a Sunday
    const result = getWeekEnding(new Date('2026-06-14T08:00:00Z'))
    expect(result.toISOString()).toBe('2026-06-14T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// buildValueSnapshot
// ---------------------------------------------------------------------------

describe('buildValueSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftCount.mockResolvedValue(0)
    mockTaskCount.mockResolvedValue(0)
    mockLeadCount.mockResolvedValue(0)
    mockJobCount.mockResolvedValue(0)
    mockApprovalCount.mockResolvedValue(0)
    mockStateCount.mockResolvedValue(0)
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: 0 } })
    mockSnapshotUpsert.mockResolvedValue({})
  })

  it('upserts a snapshot with correct weekEnding and pipelineValue', async () => {
    // Thursday 2026-06-11 → weekEnding Sunday 2026-06-14
    mockDraftCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    mockTaskCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    mockLeadCount.mockResolvedValue(4)
    mockJobCount.mockResolvedValue(5)
    mockApprovalCount.mockResolvedValue(2)
    mockStateCount.mockResolvedValue(30)
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: 8500 } })

    await buildValueSnapshot(TENANT, new Date('2026-06-11T12:00:00Z'))

    expect(mockSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_weekEnding: {
            tenantId: TENANT,
            weekEnding: new Date('2026-06-14T00:00:00.000Z'),
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          draftsCreated: 3,
          leadsDetected: 4,
          pipelineValue: 8500,
        }),
        update: expect.objectContaining({
          draftsCreated: 3,
          pipelineValue: 8500,
        }),
      })
    )
  })

  it('uses 0 for pipelineValue when aggregate returns null', async () => {
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: null } })
    await buildValueSnapshot(TENANT, NOW)
    expect(mockSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pipelineValue: 0 }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// getWeeklyTrend
// ---------------------------------------------------------------------------

describe('getWeeklyTrend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns snapshots in ascending weekEnding order', async () => {
    const snapshots = [
      { id: 's2', weekEnding: new Date('2026-06-14T00:00:00Z') },
      { id: 's1', weekEnding: new Date('2026-06-07T00:00:00Z') },
    ]
    mockSnapshotFindMany.mockResolvedValue(snapshots)

    const result = await getWeeklyTrend(TENANT, 4)

    expect(mockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT },
        orderBy: { weekEnding: 'desc' },
        take: 4,
      })
    )
    // returned in ascending order
    expect(result[0].id).toBe('s1')
    expect(result[1].id).toBe('s2')
  })

  it('defaults to 4 weeks', async () => {
    mockSnapshotFindMany.mockResolvedValue([])
    await getWeeklyTrend(TENANT)
    expect(mockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 })
    )
  })
})
