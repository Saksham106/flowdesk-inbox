import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockBuildValueSnapshot, mockTenantFindMany } = vi.hoisted(() => ({
  mockBuildValueSnapshot: vi.fn(),
  mockTenantFindMany: vi.fn(),
}))

vi.mock('@/lib/agent/value-report', () => ({
  buildValueSnapshot: mockBuildValueSnapshot,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findMany: mockTenantFindMany },
  },
}))

const CRON_SECRET = 'test-secret'

async function callRoute(authHeader?: string) {
  process.env.CRON_SECRET = CRON_SECRET
  const { POST } = await import('@/app/api/cron/value-snapshot/route')
  const req = new Request('http://localhost/api/cron/value-snapshot', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
  return POST(req)
}

describe('POST /api/cron/value-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }])
    mockBuildValueSnapshot.mockResolvedValue({})
  })

  it('returns 401 when auth header is missing', async () => {
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it('returns 401 when auth header is wrong', async () => {
    const res = await callRoute('Bearer wrong-secret')
    expect(res.status).toBe(401)
  })

  it('snapshots each tenant and returns count', async () => {
    const res = await callRoute(`Bearer ${CRON_SECRET}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.snapshotted).toBe(2)
    expect(mockBuildValueSnapshot).toHaveBeenCalledTimes(2)
    expect(mockBuildValueSnapshot).toHaveBeenCalledWith('tenant-1')
    expect(mockBuildValueSnapshot).toHaveBeenCalledWith('tenant-2')
  })
})
