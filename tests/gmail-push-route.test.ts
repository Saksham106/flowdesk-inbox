import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockProcessGmailPushNotification } = vi.hoisted(() => ({
  mockProcessGmailPushNotification: vi.fn(),
}))

vi.mock('@/lib/google', () => ({
  processGmailPushNotification: mockProcessGmailPushNotification,
}))

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

import { POST } from '@/app/api/connectors/gmail/push/route'

function makeReq(body: unknown, url = 'http://localhost/api/connectors/gmail/push?secret=test-secret') {
  return {
    url,
    json: async () => body,
    headers: new Headers(),
  }
}

describe('POST /api/connectors/gmail/push', () => {
  const previousSecret = process.env.GMAIL_PUSH_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GMAIL_PUSH_SECRET = 'test-secret'
  })

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.GMAIL_PUSH_SECRET
    } else {
      process.env.GMAIL_PUSH_SECRET = previousSecret
    }
  })

  it('rejects requests without the configured push secret', async () => {
    const res = await POST(makeReq({}, 'http://localhost/api/connectors/gmail/push') as never)

    expect(res.status).toBe(401)
    expect(mockProcessGmailPushNotification).not.toHaveBeenCalled()
  })

  it('processes a Pub/Sub push payload when the secret matches', async () => {
    mockProcessGmailPushNotification.mockResolvedValue({ ok: true, channelId: 'channel-1', synced: 2 })
    const payload = {
      message: {
        data: Buffer.from(JSON.stringify({ emailAddress: 'owner@example.com', historyId: '123' })).toString('base64url'),
      },
    }

    const res = await POST(makeReq(payload) as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, channelId: 'channel-1', synced: 2 })
    expect(mockProcessGmailPushNotification).toHaveBeenCalledWith(payload)
  })
})
