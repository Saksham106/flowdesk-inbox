import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock functions — must be created before vi.mock factories run
// ---------------------------------------------------------------------------
const { mockFindUnique, mockFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock lib/prisma BEFORE importing the module under test
// ---------------------------------------------------------------------------
vi.mock('@/lib/prisma', () => ({
  prisma: {
    businessProfile: {
      findUnique: mockFindUnique,
    },
    knowledgeDocument: {
      findMany: mockFindMany,
    },
  },
}))

import {
  getBusinessProfile,
  searchKnowledgeBase,
  getFullBusinessContext,
} from '@/lib/agent/context'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getBusinessProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls prisma.businessProfile.findUnique with the correct tenantId', async () => {
    mockFindUnique.mockResolvedValue({ id: 'bp1', tenantId: 'tenant-A' })

    await getBusinessProfile('tenant-A')

    expect(mockFindUnique).toHaveBeenCalledOnce()
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantId: 'tenant-A' } })
  })

  it('never uses a different tenants ID', async () => {
    mockFindUnique.mockResolvedValue(null)

    await getBusinessProfile('tenant-A')

    const call = mockFindUnique.mock.calls[0][0]
    expect(call.where.tenantId).toBe('tenant-A')
    expect(call.where.tenantId).not.toBe('tenant-B')
  })

  it('returns null when no profile exists', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await getBusinessProfile('tenant-A')
    expect(result).toBeNull()
  })
})

describe('searchKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('always includes tenantId in the where clause', async () => {
    mockFindMany.mockResolvedValue([])

    await searchKnowledgeBase('tenant-A', 'yoga')

    expect(mockFindMany).toHaveBeenCalledOnce()
    const call = mockFindMany.mock.calls[0][0]
    expect(call.where.tenantId).toBe('tenant-A')
  })

  it('performs case-insensitive OR on title and content', async () => {
    mockFindMany.mockResolvedValue([])

    await searchKnowledgeBase('tenant-A', 'yoga')

    const call = mockFindMany.mock.calls[0][0]
    expect(call.where.OR).toBeDefined()
    expect(call.where.OR).toHaveLength(2)

    const [titleClause, contentClause] = call.where.OR
    expect(titleClause).toMatchObject({ title: { contains: 'yoga', mode: 'insensitive' } })
    expect(contentClause).toMatchObject({ content: { contains: 'yoga', mode: 'insensitive' } })
  })

  it('limits results to 10', async () => {
    mockFindMany.mockResolvedValue([])

    await searchKnowledgeBase('tenant-A', 'yoga')

    const call = mockFindMany.mock.calls[0][0]
    expect(call.take).toBe(10)
  })

  it('still includes tenantId filter even with an empty query', async () => {
    mockFindMany.mockResolvedValue([])

    await searchKnowledgeBase('tenant-A', '')

    const call = mockFindMany.mock.calls[0][0]
    expect(call.where.tenantId).toBe('tenant-A')
  })
})

describe('getFullBusinessContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an object with profile and documents fields', async () => {
    const fakeProfile = { id: 'bp1', tenantId: 'tenant-A', businessName: 'Spa' }
    const fakeDocs = [{ id: 'kd1', tenantId: 'tenant-A', title: 'Menu' }]

    mockFindUnique.mockResolvedValue(fakeProfile)
    mockFindMany.mockResolvedValue(fakeDocs)

    const result = await getFullBusinessContext('tenant-A')

    expect(result).toHaveProperty('profile')
    expect(result).toHaveProperty('documents')
    expect(result.profile).toEqual(fakeProfile)
    expect(result.documents).toEqual(fakeDocs)
  })

  it('scopes both calls to the same tenantId', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockFindMany.mockResolvedValue([])

    await getFullBusinessContext('tenant-A')

    expect(mockFindUnique.mock.calls[0][0].where.tenantId).toBe('tenant-A')
    expect(mockFindMany.mock.calls[0][0].where.tenantId).toBe('tenant-A')
  })
})
