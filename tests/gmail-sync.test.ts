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
  mockThreadsList,
  mockThreadsGet,
} = vi.hoisted(() => ({
  mockChannelFindUnique:    vi.fn(),
  mockCredFindUnique:       vi.fn(),
  mockContactFindUnique:    vi.fn(),
  mockContactCreate:        vi.fn(),
  mockConversationUpsert:   vi.fn(),
  mockMessageUpsert:        vi.fn(),
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
    message: { upsert: mockMessageUpsert },
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
        messages: { send: vi.fn() },
      },
    }),
  },
}))

vi.mock('@/lib/crypto', () => ({
  encryptString: (s: string) => `enc:${s}`,
  decryptString: (s: string) => s.replace(/^enc:/, ''),
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

  it('upserts a conversation and message for each inbound thread', async () => {
    const thread = makeThread('thread-1', 'customer@example.com', CHANNEL_EMAIL)
    mockThreadsList.mockResolvedValue({ data: { threads: [{ id: 'thread-1' }] } })
    mockThreadsGet.mockResolvedValue(thread)

    mockContactFindUnique.mockResolvedValue(null)
    mockContactCreate.mockResolvedValue({ id: 'contact-1', name: 'customer@example.com', phoneE164: 'customer@example.com' })
    mockConversationUpsert.mockResolvedValue({ id: 'conv-1' })
    mockMessageUpsert.mockResolvedValue({})

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
})
