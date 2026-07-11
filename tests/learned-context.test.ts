import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTenantFindUnique,
  mockBusinessProfileFindUnique,
  mockKnowledgeFindMany,
  mockProfileFindFirst,
  mockWritingPreferenceFindUnique,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockBusinessProfileFindUnique: vi.fn(),
  mockKnowledgeFindMany: vi.fn(),
  mockProfileFindFirst: vi.fn(),
  mockWritingPreferenceFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    businessProfile: { findUnique: mockBusinessProfileFindUnique },
    knowledgeDocument: { findMany: mockKnowledgeFindMany },
    learnedReplyProfile: { findFirst: mockProfileFindFirst },
    writingPreference: { findUnique: mockWritingPreferenceFindUnique },
  },
}))

import { getReplyGenerationContext } from '@/lib/agent/reply-context'

describe('getReplyGenerationContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads business context plus learned style for business tenants', async () => {
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-A', salesCrmEnabled: true })
    mockBusinessProfileFindUnique.mockResolvedValue({ businessName: 'Glow Studio' })
    mockKnowledgeFindMany.mockResolvedValue([{ id: 'doc-1', title: 'Pricing', content: 'Facials start at $199.' }])
    mockProfileFindFirst.mockResolvedValue({ id: 'profile-1', styleSummaryJson: { tone: 'warm' } })

    const context = await getReplyGenerationContext({ tenantId: 'tenant-A', channelId: 'channel-1' })

    expect(context.accountType).toBe('business')
    expect(context.businessProfile?.businessName).toBe('Glow Studio')
    expect(context.knowledgeDocuments).toHaveLength(1)
    expect(context.learnedProfile?.id).toBe('profile-1')
    expect(mockProfileFindFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: 'tenant-A',
      channelId: 'channel-1',
      profileType: 'business',
    })
  })

  it('loads learned style without business facts for personal tenants', async () => {
    mockTenantFindUnique.mockResolvedValue({ id: 'tenant-A', salesCrmEnabled: false })
    mockProfileFindFirst.mockResolvedValue({ id: 'profile-2', styleSummaryJson: { tone: 'casual' } })

    const context = await getReplyGenerationContext({ tenantId: 'tenant-A', channelId: 'channel-1' })

    expect(context.accountType).toBe('personal')
    expect(context.businessProfile).toBeNull()
    expect(context.knowledgeDocuments).toEqual([])
    expect(context.learnedProfile?.id).toBe('profile-2')
    expect(mockBusinessProfileFindUnique).not.toHaveBeenCalled()
    expect(mockKnowledgeFindMany).not.toHaveBeenCalled()
  })
})
