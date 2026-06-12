import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockLeadFindMany } = vi.hoisted(() => ({
  mockLeadFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findMany: mockLeadFindMany },
  },
}))

import { analyzeRevenueAtRisk } from '@/lib/agent/revenue-at-risk'

const TENANT = 'tenant-1'
const NOW = new Date('2026-06-12T12:00:00Z')

function makeLead(overrides: {
  estimatedValue?: number
  stage?: string
  lastMessageAt?: Date
  draftStatus?: string | null
  name?: string
  conversationId?: string
}) {
  return {
    estimatedValue: overrides.estimatedValue ?? 2000,
    stage: overrides.stage ?? 'qualified',
    conversationId: overrides.conversationId ?? 'conv-1',
    conversation: {
      lastMessageAt: overrides.lastMessageAt ?? new Date('2026-06-08T12:00:00Z'),
      contact: { name: overrides.name ?? 'Alice' },
      draft: overrides.draftStatus !== undefined ? { status: overrides.draftStatus } : null,
    },
  }
}

describe('analyzeRevenueAtRisk', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns mapped items sorted by estimatedValue descending', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead({ estimatedValue: 5000, name: 'Big Deal', conversationId: 'conv-1' }),
      makeLead({ estimatedValue: 1500, name: 'Smaller Deal', conversationId: 'conv-2' }),
    ])

    const result = await analyzeRevenueAtRisk(TENANT, NOW)

    expect(result).toHaveLength(2)
    expect(result[0].contactName).toBe('Big Deal')
    expect(result[0].estimatedValue).toBe(5000)
    expect(result[0].conversationId).toBe('conv-1')
    expect(result[0].daysSinceLastMessage).toBe(4) // 2026-06-08 → 2026-06-12
    expect(result[0].stage).toBe('qualified')
  })

  it('queries with correct tenantId and orders by estimatedValue desc', async () => {
    mockLeadFindMany.mockResolvedValue([])
    await analyzeRevenueAtRisk(TENANT, NOW)

    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
        orderBy: { estimatedValue: 'desc' },
        take: 5,
      })
    )
  })

  it('returns empty array when no leads match', async () => {
    mockLeadFindMany.mockResolvedValue([])
    const result = await analyzeRevenueAtRisk(TENANT, NOW)
    expect(result).toEqual([])
  })

  it('falls back to "Unknown" when contact is null', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        estimatedValue: 3000,
        stage: 'proposal',
        conversationId: 'conv-3',
        conversation: {
          lastMessageAt: new Date('2026-06-08T00:00:00Z'),
          contact: null,
          draft: null,
        },
      },
    ])
    const result = await analyzeRevenueAtRisk(TENANT, NOW)
    expect(result[0].contactName).toBe('Unknown')
  })
})
