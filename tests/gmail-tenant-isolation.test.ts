import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockChannelFindFirst,
  mockCredFindUnique,
  mockCredUpdate,
  mockSyncGmailChannel,
  mockSyncGmailChannelIncremental,
  mockWatchGmailChannel,
} = vi.hoisted(() => ({
  mockChannelFindFirst: vi.fn(),
  mockCredFindUnique: vi.fn(),
  mockCredUpdate: vi.fn(),
  mockSyncGmailChannel: vi.fn(),
  mockSyncGmailChannelIncremental: vi.fn(),
  mockWatchGmailChannel: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findFirst: mockChannelFindFirst },
    gmailCredential: { findUnique: mockCredFindUnique, update: mockCredUpdate },
  },
}))

vi.mock('@/lib/google', () => ({
  syncGmailChannel: mockSyncGmailChannel,
  syncGmailChannelIncremental: mockSyncGmailChannelIncremental,
  watchGmailChannel: mockWatchGmailChannel,
}))

let mockSession: unknown = null
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}))

vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('next/server', () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    async json() { return this.body }
    static json(body: unknown, init?: { status?: number }) {
      return new NextResponse(body, init)
    }
  }
  return { NextResponse }
})

import { POST } from '@/app/api/connectors/gmail/sync/route'

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/connectors/gmail/sync — tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GMAIL_PUSH_TOPIC
    mockSyncGmailChannel.mockResolvedValue(3)
    mockSyncGmailChannelIncremental.mockResolvedValue({ synced: 2, newHistoryId: 'history-2' })
    mockWatchGmailChannel.mockResolvedValue({ expiration: new Date(), historyId: 'history-2' })
  })

  it('returns 401 with no session', async () => {
    mockSession = null
    const res = await POST(makeReq({ channelId: 'ch-1' }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when channelId is missing', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    const res = await POST(makeReq({}) as never)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the channel belongs to a different tenant', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    // findFirst scoped to tenantId returns null — channel belongs to tenant-B
    mockChannelFindFirst.mockResolvedValue(null)

    const res = await POST(makeReq({ channelId: 'ch-tenant-B' }) as never)

    expect(res.status).toBe(404)
    expect(mockChannelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-A' }),
      })
    )
  })

  it('syncs successfully when the channel belongs to the session tenant', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockCredUpdate.mockResolvedValue({})

    const res = await POST(makeReq({ channelId: 'ch-1' }) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.synced).toBe(3)
  })

  it('uses incremental sync when a history cursor already exists', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockCredFindUnique.mockResolvedValue({ channelId: 'ch-1', historyId: 'history-1' })
    mockCredUpdate.mockResolvedValue({})

    const res = await POST(makeReq({ channelId: 'ch-1', incremental: true }) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.synced).toBe(2)
    expect(mockSyncGmailChannelIncremental).toHaveBeenCalledWith('ch-1', 'tenant-A')
    expect(mockSyncGmailChannel).not.toHaveBeenCalled()
  })

  it('falls back to full sync when incremental is requested without a history cursor', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockCredFindUnique.mockResolvedValue({ channelId: 'ch-1', historyId: null })
    mockCredUpdate.mockResolvedValue({})

    const res = await POST(makeReq({ channelId: 'ch-1', incremental: true }) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.synced).toBe(3)
    expect(mockSyncGmailChannel).toHaveBeenCalledWith('ch-1', 'tenant-A')
    expect(mockSyncGmailChannelIncremental).not.toHaveBeenCalled()
  })

  it('updates lastSyncedAt and clears lastSyncError on success', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockCredUpdate.mockResolvedValue({})

    await POST(makeReq({ channelId: 'ch-1' }) as never)

    expect(mockCredUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'ch-1' },
        data: expect.objectContaining({ lastSyncError: null }),
      })
    )
  })
})
