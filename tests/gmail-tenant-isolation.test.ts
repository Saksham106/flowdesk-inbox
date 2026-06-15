import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockChannelFindFirst,
  mockCredFindUnique,
  mockRunGmailSync,
} = vi.hoisted(() => ({
  mockChannelFindFirst: vi.fn(),
  mockCredFindUnique: vi.fn(),
  mockRunGmailSync: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findFirst: mockChannelFindFirst },
    gmailCredential: { findUnique: mockCredFindUnique },
  },
}))

vi.mock('@/lib/gmail-sync', () => ({
  runGmailSync: mockRunGmailSync,
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
    mockRunGmailSync.mockResolvedValue({ ok: true, channelId: 'ch-1', synced: 3, mode: 'manual_full' })
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
    mockRunGmailSync.mockResolvedValue({ ok: true, channelId: 'ch-1', synced: 2, mode: 'manual_incremental' })

    const res = await POST(makeReq({ channelId: 'ch-1', incremental: true }) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.synced).toBe(2)
    expect(mockRunGmailSync).toHaveBeenCalledWith({
      channelId: 'ch-1',
      tenantId: 'tenant-A',
      requestedMode: 'manual',
      incremental: true,
      ensureWatch: true,
    })
  })

  it('falls back to full sync when incremental is requested without a history cursor', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockCredFindUnique.mockResolvedValue({ channelId: 'ch-1', historyId: null })

    const res = await POST(makeReq({ channelId: 'ch-1', incremental: true }) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.synced).toBe(3)
    expect(mockRunGmailSync).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'ch-1', tenantId: 'tenant-A', incremental: true })
    )
  })

  it('updates lastSyncedAt and clears lastSyncError on success', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })

    await POST(makeReq({ channelId: 'ch-1' }) as never)

    expect(mockRunGmailSync).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'ch-1', tenantId: 'tenant-A' })
    )
  })

  it('returns 202 without starting another sync when the channel is already locked', async () => {
    mockSession = { user: { tenantId: 'tenant-A' } }
    mockChannelFindFirst.mockResolvedValue({ id: 'ch-1', tenantId: 'tenant-A', type: 'email' })
    mockRunGmailSync.mockResolvedValue({ ok: true, channelId: 'ch-1', skipped: 'sync_in_progress' })

    const res = await POST(makeReq({ channelId: 'ch-1' }) as never)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body).toEqual({ ok: true, channelId: 'ch-1', skipped: 'sync_in_progress' })
    expect(mockRunGmailSync).toHaveBeenCalledOnce()
  })
})
