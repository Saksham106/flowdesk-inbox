import { describe, it, expect, vi, beforeEach } from 'vitest'

// runValueSnapshotCron and buildValueSnapshot live in the same module and
// buildValueSnapshot is called as a direct local reference, so vi.mock'ing
// just that one export wouldn't affect the internal call — mock at the
// prisma layer instead, same pattern as the other cron tests.
const { mockTenantFindMany, mockLeadAggregate, mockValueSnapshotUpsert, mockCount } = vi.hoisted(() => ({
  mockTenantFindMany: vi.fn(),
  mockLeadAggregate: vi.fn(),
  mockValueSnapshotUpsert: vi.fn(),
  mockCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findMany: mockTenantFindMany },
    draft: { count: mockCount },
    inboxTask: { count: mockCount },
    lead: { count: mockCount, aggregate: mockLeadAggregate },
    agentJob: { count: mockCount },
    approvalRequest: { count: mockCount },
    conversationState: { count: mockCount },
    valueSnapshot: { upsert: mockValueSnapshotUpsert },
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
    mockCount.mockResolvedValue(0)
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: 0 } })
    mockValueSnapshotUpsert.mockResolvedValue({})
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
    expect(mockValueSnapshotUpsert).toHaveBeenCalledTimes(2)
    expect(mockValueSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_weekEnding: expect.objectContaining({ tenantId: 'tenant-1' }) } })
    )
    expect(mockValueSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_weekEnding: expect.objectContaining({ tenantId: 'tenant-2' }) } })
    )
  })

  it('counts failures without aborting the batch', async () => {
    mockValueSnapshotUpsert.mockRejectedValueOnce(new Error('db error')).mockResolvedValueOnce({})
    const res = await callRoute(`Bearer ${CRON_SECRET}`)
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.snapshotted).toBe(1)
    expect(body.failed).toBe(1)
  })
})
