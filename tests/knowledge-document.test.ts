import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock functions — available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockFindMany,
  mockCreate,
  mockFindFirst,
  mockFindUnique,
  mockDeleteMany,
  mockUpdateMany,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockUpdateMany: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgeDocument: {
      findMany: mockFindMany,
      create: mockCreate,
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      deleteMany: mockDeleteMany,
      updateMany: mockUpdateMany,
    },
  },
}))

// Session mock — controlled per-test via `mockSession`
let mockSession: unknown = null
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// Minimal NextResponse/NextRequest shims
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

import { GET, POST } from '@/app/api/knowledge-documents/route'
import { DELETE } from '@/app/api/knowledge-documents/[id]/route'

// Helper to create a fake request whose .json() resolves to `body`
function makeReq(body: Record<string, unknown> = {}): { json: () => Promise<unknown> } {
  return { json: async () => body }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/knowledge-documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when there is no session', async () => {
    mockSession = null
    const res = await GET(makeReq() as never)
    expect(res.status).toBe(401)
  })

  it('scopes the query to the session tenantId', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockFindMany.mockResolvedValue([])

    await GET(makeReq() as never)

    expect(mockFindMany).toHaveBeenCalledOnce()
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-A' })
  })

  it('does not leak documents from another tenant', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockFindMany.mockResolvedValue([])

    await GET(makeReq() as never)

    const where = mockFindMany.mock.calls[0][0].where
    expect(where.tenantId).not.toBe('tenant-B')
  })
})

describe('POST /api/knowledge-documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets tenantId from session, not from the request body', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockCreate.mockResolvedValue({ id: 'kd1', tenantId: 'tenant-A' })

    const req = makeReq({ title: 'Menu', content: 'Details', tenantId: 'tenant-EVIL' })

    await POST(req as never)

    expect(mockCreate).toHaveBeenCalledOnce()
    const data = mockCreate.mock.calls[0][0].data
    expect(data.tenantId).toBe('tenant-A')
    expect(data.tenantId).not.toBe('tenant-EVIL')
  })

  it('returns 401 without session', async () => {
    mockSession = null
    const res = await POST(makeReq({ title: 'Menu', content: 'Details' }) as never)
    expect(res.status).toBe(401)
  })

  it('rejects whitespace-only title', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    const res = await POST(makeReq({ title: '   ', content: 'Good content' }) as never)
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/knowledge-documents/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when document belongs to a different tenant', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    // deleteMany with compound where returns count=0 (no match for tenant-A)
    mockDeleteMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(makeReq() as never, { params: { id: 'kd1' } })

    expect(res.status).toBe(404)
  })

  it('deletes a document that belongs to the session tenant', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockDeleteMany.mockResolvedValue({ count: 1 })

    const res = await DELETE(makeReq() as never, { params: { id: 'kd1' } })

    expect(res.status).toBe(200)
    expect(mockDeleteMany).toHaveBeenCalledOnce()
    // Verify tenantId is part of the where clause (atomic ownership check)
    expect(mockDeleteMany.mock.calls[0][0].where).toMatchObject({
      id: 'kd1',
      tenantId: 'tenant-A',
    })
  })

  it('returns 404 when document does not exist', async () => {
    mockSession = { user: { id: 'user1', tenantId: 'tenant-A' } }
    mockDeleteMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(makeReq() as never, { params: { id: 'missing-id' } })

    expect(res.status).toBe(404)
  })

  it('returns 401 without session', async () => {
    mockSession = null
    const res = await DELETE(makeReq() as never, { params: { id: 'kd1' } })
    expect(res.status).toBe(401)
  })
})
