import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCredentialFindUnique, mockMessagesList, mockMessagesGet } = vi.hoisted(() => ({
  mockCredentialFindUnique: vi.fn(),
  mockMessagesList: vi.fn(),
  mockMessagesGet: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { gmailCredential: { findUnique: mockCredentialFindUnique } },
}))

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn(), on: vi.fn() })) },
    gmail: vi.fn().mockReturnValue({
      users: { messages: { list: mockMessagesList, get: mockMessagesGet } },
    }),
  },
}))

vi.mock('@/lib/crypto', () => ({
  decryptString: (value: string) => value,
  encryptString: (value: string) => value,
}))

vi.mock('@/lib/agent/work-item-sync', () => ({ syncConversationWorkItems: vi.fn() }))

import { fetchGmailSentSamples } from '@/lib/google'

describe('fetchGmailSentSamples', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredentialFindUnique.mockResolvedValue({
      channelId: 'channel-1', accessTokenEncrypted: 'access', refreshTokenEncrypted: 'refresh', tokenExpiry: null,
    })
  })

  it('returns sent text with Gmail headers, subject, and source provenance', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'message-1', threadId: 'thread-1' }] } })
    mockMessagesGet.mockResolvedValue({
      data: {
        id: 'message-1', threadId: 'thread-1', internalDate: '1780833600000',
        payload: {
          headers: [
            { name: 'Subject', value: 'Re: Project update' },
            { name: 'Auto-Submitted', value: 'no' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Hi Maya, I can send this tomorrow.').toString('base64url') },
        },
      },
    })

    await expect(fetchGmailSentSamples('channel-1', 10)).resolves.toEqual([
      {
        text: 'Hi Maya, I can send this tomorrow.',
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
        subject: 'Re: Project update',
        headers: { Subject: 'Re: Project update', 'Auto-Submitted': 'no' },
        provenance: { source: 'gmail_sent', messageId: 'message-1', threadId: 'thread-1' },
      },
    ])
    expect(mockMessagesGet).toHaveBeenCalledWith({ userId: 'me', id: 'message-1', format: 'full' })
  })
})
