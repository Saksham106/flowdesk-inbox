import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock functions
// ---------------------------------------------------------------------------
const {
  mockChannelFindUnique,
  mockCredFindUnique,
  mockContactFindUnique,
  mockContactCreate,
  mockConversationUpsert,
  mockMessageUpsert,
  mockMessageFindUnique,
  mockSyncConversationWorkItems,
  mockThreadsList,
  mockThreadsGet,
} = vi.hoisted(() => ({
  mockChannelFindUnique:    vi.fn(),
  mockCredFindUnique:       vi.fn(),
  mockContactFindUnique:    vi.fn(),
  mockContactCreate:        vi.fn(),
  mockConversationUpsert:   vi.fn(),
  mockMessageUpsert:        vi.fn(),
  mockMessageFindUnique:     vi.fn(),
  mockSyncConversationWorkItems: vi.fn(),
  mockThreadsList:          vi.fn(),
  mockThreadsGet:           vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findUnique: mockChannelFindUnique },
    gmailCredential: { findUnique: mockCredFindUnique },
    contact: { findUnique: mockContactFindUnique, create: mockContactCreate },
    conversation: { upsert: mockConversationUpsert },
    message: { upsert: mockMessageUpsert, findUnique: mockMessageFindUnique },
  },
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        on: vi.fn(),
      })),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        threads: { list: mockThreadsList, get: mockThreadsGet },
        messages: { send: vi.fn(), modify: vi.fn() },
      },
    }),
  },
}))

vi.mock('@/lib/crypto', () => ({
  encryptString: (s: string) => `enc:${s}`,
  decryptString: (s: string) => s.replace(/^enc:/, ''),
}))

vi.mock('@/lib/agent/work-item-sync', () => ({
  syncConversationWorkItems: mockSyncConversationWorkItems,
}))

import { syncGmailChannel } from '@/lib/google'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeThread(id: string, from: string, to: string) {
  return {
    id,
    data: {
      messages: [
        {
          id: `msg_${id}`,
          threadId: id,
          internalDate: '1700000000000',
          payload: {
            headers: [
              { name: 'From',       value: from  },
              { name: 'To',         value: to    },
              { name: 'Subject',    value: 'Test subject' },
              { name: 'Message-ID', value: `<${id}@mail.example.com>` },
            ],
            body: { data: Buffer.from('Hello there').toString('base64') },
          },
        },
      ],
    },
  }
}

function b64(value: string): string {
  return Buffer.from(value).toString('base64url')
}

const CHANNEL_EMAIL = 'business@example.com'
const TENANT_ID     = 'tenant-1'
const CHANNEL_ID    = 'channel-1'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncGmailChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockChannelFindUnique.mockResolvedValue({ id: CHANNEL_ID, emailAddress: CHANNEL_EMAIL })
    mockCredFindUnique.mockResolvedValue({
      channelId: CHANNEL_ID,
      accessTokenEncrypted:  'enc:access',
      refreshTokenEncrypted: 'enc:refresh',
      tokenExpiry: null,
    })
  })

  it('returns 0 when there are no threads', async () => {
    mockThreadsList.mockResolvedValue({ data: { threads: [] } })

    const count = await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    expect(count).toBe(0)
    expect(mockConversationUpsert).not.toHaveBeenCalled()
  })

  it('limits full inbox sync to the requested recent-thread batch size', async () => {
    mockThreadsList.mockResolvedValue({ data: { threads: [] } })

    await syncGmailChannel(CHANNEL_ID, TENANT_ID, { maxThreads: 20 })

    expect(mockThreadsList).toHaveBeenCalledWith({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 20,
    })
  })

  it('caps full inbox sync batches at 50 threads for safer testing', async () => {
    mockThreadsList.mockResolvedValue({ data: { threads: [] } })

    await syncGmailChannel(CHANNEL_ID, TENANT_ID, { maxThreads: 500 })

    expect(mockThreadsList).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 50 })
    )
  })

  it('upserts a conversation and message for each inbound thread', async () => {
    const thread = makeThread('thread-1', 'customer@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-1' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    mockContactFindUnique.mockResolvedValue(null)
    mockContactCreate.mockResolvedValue({ id: 'contact-1', name: 'customer@example.com', phoneE164: 'customer@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-1' })
    mockMessageUpsert.mockResolvedValue({})
    mockMessageFindUnique.mockResolvedValue(null)
    mockSyncConversationWorkItems.mockResolvedValue({})

    const count = await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    expect(count).toBe(1)
    expect(mockConversationUpsert).toHaveBeenCalledOnce()
    expect(mockMessageUpsert).toHaveBeenCalledOnce()
  })

  it('reuses an existing contact instead of creating a duplicate', async () => {
    const thread = makeThread('thread-2', 'returning@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-2' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    const existing = { id: 'contact-existing', name: 'Returning Customer', phoneE164: 'returning@example.com' }
    mockContactFindUnique.mockResolvedValue(existing)
    mockConversationUpsert.mockResolvedValue({ id: 'conv-2' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    expect(mockContactCreate).not.toHaveBeenCalled()
    expect(mockConversationUpsert.mock.calls[0][0].create.contactId).toBe('contact-existing')
  })

  it('is idempotent — upserting the same thread twice does not create duplicates', async () => {
    const thread = makeThread('thread-3', 'customer@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-3' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    mockContactFindUnique.mockResolvedValue({ id: 'c1', phoneE164: 'customer@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-3' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)
    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    // upsert called twice (once per sync) but always on the same unique key — no duplicates
    expect(mockConversationUpsert).toHaveBeenCalledTimes(2)
    const key1 = mockConversationUpsert.mock.calls[0][0].where
    const key2 = mockConversationUpsert.mock.calls[1][0].where
    expect(key1).toEqual(key2)
  })

  it('stores the external email in the contact phoneE164 field', async () => {
    const thread = makeThread('thread-4', 'newclient@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-4' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    mockContactFindUnique.mockResolvedValue(null)
    mockContactCreate.mockResolvedValue({ id: 'c2', phoneE164: 'newclient@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-4' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    const createArg = mockContactCreate.mock.calls[0][0].data
    expect(createArg.phoneE164).toBe('newclient@example.com')
    expect(createArg.tenantId).toBe(TENANT_ID)
  })

  it('correctly marks inbound vs outbound message direction', async () => {
    const thread = makeThread('thread-5', 'customer@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-5' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    mockContactFindUnique.mockResolvedValue({ id: 'c3', phoneE164: 'customer@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-5' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    const msgArg = mockMessageUpsert.mock.calls[0][0].create
    expect(msgArg.direction).toBe('inbound')
  })

  it('stores the HTML alternative for newsletter-style Gmail messages instead of plain-text CSS junk', async () => {
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-html' }] } })
    mockThreadsGet.mockResolvedValue({
      data: {
        messages: [
          {
            id: 'msg_html',
            threadId: 'thread-html',
            internalDate: '1700000000000',
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: 'newsletter@example.com' },
                { name: 'To', value: CHANNEL_EMAIL },
                { name: 'Subject', value: '5-Bullet Friday' },
                { name: 'Message-ID', value: '<html@mail.example.com>' },
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: {
                    data: b64('a {text-decoration: none;}\n***************\n5-Bullet Friday\n***************'),
                  },
                },
                {
                  mimeType: 'text/html',
                  body: {
                    data: b64('<html><body><img src="https://cdn.example.com/banner.jpg" alt="5-Bullet Friday"><h1>5-Bullet Friday</h1><p>Readable intro</p></body></html>'),
                  },
                },
              ],
            },
          },
        ],
      },
    })
    mockContactFindUnique.mockResolvedValue({ id: 'c-html', phoneE164: 'newsletter@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-html' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    const body = mockMessageUpsert.mock.calls[0][0].create.body
    expect(body).toContain('<img src="https://cdn.example.com/banner.jpg"')
    expect(body).toContain('<h1>5-Bullet Friday</h1>')
    expect(body).not.toContain('a {text-decoration: none;}')
  })

  it('preserves HTML hrefs from Gmail without rewriting tracking or final URLs', async () => {
    const finalUrl = 'https://tailscale.com/blog/ai-without-lock-in?utm_campaign=aperture-onboarding&utm_medium=email&_hsmi=423871348&utm_source=hs_email'
    const trackingUrl = 'https://info.tailscale.com/e3t/Ctc/OT+113/d4K34c04/VX8QL33KvRDRW6lM-WB6GpGF8W9fbdmV5Qmkd9N8GDX6T3qgz0W7Y8-PT6lZ3mBW2k9_gr3nCxcXW40hBfy4sz-8v'
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-links' }] } })
    mockThreadsGet.mockResolvedValue({
      data: {
        messages: [
          {
            id: 'msg_links',
            threadId: 'thread-links',
            internalDate: '1700000000000',
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: 'newsletter@tailscale.com' },
                { name: 'To', value: CHANNEL_EMAIL },
                { name: 'Subject', value: 'Links' },
                { name: 'Message-ID', value: '<links@mail.example.com>' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: b64(`Read ${finalUrl}`) } },
                {
                  mimeType: 'text/html',
                  body: {
                    data: b64(`<html><body><a href="${finalUrl}">Final</a><a href="${trackingUrl}">Tracking</a></body></html>`),
                  },
                },
              ],
            },
          },
        ],
      },
    })
    mockContactFindUnique.mockResolvedValue({ id: 'c-links', phoneE164: 'newsletter@tailscale.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-links' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    const body = mockMessageUpsert.mock.calls[0][0].create.body
    expect(body).toContain(`href="${finalUrl}"`)
    expect(body).toContain(`href="${trackingUrl}"`)
    expect(body).not.toContain('&amp;amp;')
    expect(body).not.toContain('%252B')
  })

  it('finds HTML inside nested multipart/related payloads', async () => {
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-related' }] } })
    mockThreadsGet.mockResolvedValue({
      data: {
        messages: [
          {
            id: 'msg_related',
            threadId: 'thread-related',
            internalDate: '1700000000000',
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                { name: 'From', value: 'notify@example.com' },
                { name: 'To', value: CHANNEL_EMAIL },
                { name: 'Subject', value: 'Nested HTML' },
                { name: 'Message-ID', value: '<related@mail.example.com>' },
              ],
              parts: [
                {
                  mimeType: 'multipart/related',
                  parts: [
                    {
                      mimeType: 'multipart/alternative',
                      parts: [
                        { mimeType: 'text/plain', body: { data: b64('Fallback only') } },
                        {
                          mimeType: 'text/html',
                          body: { data: b64('<div><table><tr><td>Transactional layout</td></tr></table></div>') },
                        },
                      ],
                    },
                    { mimeType: 'image/png', body: { attachmentId: 'inline-1' } },
                  ],
                },
              ],
            },
          },
        ],
      },
    })
    mockContactFindUnique.mockResolvedValue({ id: 'c-related', phoneE164: 'notify@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-related' })
    mockMessageUpsert.mockResolvedValue({})

    await syncGmailChannel(CHANNEL_ID, TENANT_ID)

    expect(mockMessageUpsert.mock.calls[0][0].create.body).toContain('<table>')
    expect(mockMessageUpsert.mock.calls[0][0].create.body).toContain('Transactional layout')
  })

  it('treats a concurrent duplicate message insert as already synced', async () => {
    const thread = makeThread('thread-race', 'customer@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-race' }] } })
    mockThreadsGet.mockResolvedValue(thread)
    mockContactFindUnique.mockResolvedValue({ id: 'c-race', phoneE164: 'customer@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-race' })
    mockMessageUpsert.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed on providerMessageId'), { code: 'P2002' }))
    mockMessageFindUnique.mockResolvedValueOnce({ id: 'message-race', conversationId: 'conv-race' })

    await expect(syncGmailChannel(CHANNEL_ID, TENANT_ID)).resolves.toBe(1)

    expect(mockMessageFindUnique).toHaveBeenCalledWith({
      where: { providerMessageId: 'gmail_msg_thread-race' },
      select: { id: true, conversationId: true },
    })
  })
})
