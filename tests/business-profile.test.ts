import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock functions
// ---------------------------------------------------------------------------
const { mockFindUnique, mockUpsert, mockAuditCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    businessProfile: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
    auditLog: {
      create: mockAuditCreate,
    },
  },
}))

let mockSession: unknown = null
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('next/server', () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() {
      return this.body
    }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  class NextRequest {
    _body: unknown
    constructor(_url: string, init?: { body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
    }
    async json() {
      return this._body
    }
  }
  return { NextResponse, NextRequest }
})

import { GET, PATCH } from '@/app/api/business-profile/route'

function makeReq(body: Record<string, unknown> = {}): { json: () => Promise<unknown> } {
  return { json: async () => body }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/business-profile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when there is no session', async () => {
    mockSession = null
    const res = await GET(makeReq() as never)
    expect(res.status).toBe(401)
  })

  it('scopes the lookup to the session tenantId', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockFindUnique.mockResolvedValue({ id: 'bp1', tenantId: 'tenant-A', businessName: 'Spa' })

    await GET(makeReq() as never)

    expect(mockFindUnique).toHaveBeenCalledOnce()
    expect(mockFindUnique.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-A' })
  })

  it('returns 404 when no profile exists', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockFindUnique.mockResolvedValue(null)

    const res = await GET(makeReq() as never)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/business-profile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without session', async () => {
    mockSession = null
    const res = await PATCH(makeReq({ businessName: 'New Spa' }) as never)
    expect(res.status).toBe(401)
  })

  it('upserts with the correct tenantId from the session', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    const fakeProfile = { id: 'bp1', tenantId: 'tenant-A', businessName: 'Glow Spa' }
    mockUpsert.mockResolvedValue(fakeProfile)
    mockAuditCreate.mockResolvedValue({})

    await PATCH(makeReq({ businessName: 'Glow Spa' }) as never)

    expect(mockUpsert).toHaveBeenCalledOnce()
    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.where).toMatchObject({ tenantId: 'tenant-A' })
    expect(arg.create.tenantId).toBe('tenant-A')
  })

  it('writes an AuditLog entry after upsert', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    const fakeProfile = { id: 'bp1', tenantId: 'tenant-A', businessName: 'Glow Spa' }
    mockUpsert.mockResolvedValue(fakeProfile)
    mockAuditCreate.mockResolvedValue({})

    await PATCH(makeReq({ businessName: 'Glow Spa' }) as never)

    expect(mockAuditCreate).toHaveBeenCalledOnce()
    const auditArg = mockAuditCreate.mock.calls[0][0].data
    expect(auditArg.tenantId).toBe('tenant-A')
    expect(auditArg.action).toBe('business_profile.upsert')
  })

  it('never uses a tenantId supplied by the request body', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockUpsert.mockResolvedValue({ id: 'bp1', tenantId: 'tenant-A' })
    mockAuditCreate.mockResolvedValue({})

    // Attacker tries to set tenantId via body
    await PATCH(makeReq({ businessName: 'Evil Spa', tenantId: 'tenant-EVIL' }) as never)

    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.where.tenantId).toBe('tenant-A')
    expect(arg.create.tenantId).toBe('tenant-A')
    expect(arg.create.tenantId).not.toBe('tenant-EVIL')
  })
})
