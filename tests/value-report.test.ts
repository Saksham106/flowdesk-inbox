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
} = vi.hoisted(() => ({
  mockDraftCount:    vi.fn(),
  mockTaskCount:     vi.fn(),
  mockLeadCount:     vi.fn(),
  mockJobCount:      vi.fn(),
  mockApprovalCount: vi.fn(),
  mockStateCount:    vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft:             { count: mockDraftCount },
    inboxTask:         { count: mockTaskCount },
    lead:              { count: mockLeadCount },
    agentJob:          { count: mockJobCount },
    approvalRequest:   { count: mockApprovalCount },
    conversationState: { count: mockStateCount },
  },
}))

import {
  getReportPeriod,
  estimateMinutesSaved,
  buildWeeklyValueReport,
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
