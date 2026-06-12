import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMessageFindMany,
  mockProfileFindFirst,
  mockProfileCreate,
  mockProfileUpdate,
  mockSummarize,
  mockUsageCreate,
  mockFetchGmailSentSamples,
} = vi.hoisted(() => ({
  mockMessageFindMany: vi.fn(),
  mockProfileFindFirst: vi.fn(),
  mockProfileCreate: vi.fn(),
  mockProfileUpdate: vi.fn(),
  mockSummarize: vi.fn(),
  mockUsageCreate: vi.fn(),
  mockFetchGmailSentSamples: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    message: { findMany: mockMessageFindMany },
    learnedReplyProfile: {
      findFirst: mockProfileFindFirst,
      create: mockProfileCreate,
      update: mockProfileUpdate,
    },
    aiUsageEvent: { create: mockUsageCreate },
  },
}))

vi.mock('@/lib/ai/provider', () => ({
  summarizeLearnedReplyProfile: mockSummarize,
}))

vi.mock('@/lib/google', () => ({
  fetchGmailSentSamples: mockFetchGmailSentSamples,
}))

import {
  collectOutboundReplySamples,
  sanitizeOutboundReply,
  trainLearnedReplyProfile,
} from '@/lib/agent/reply-learning'

describe('sanitizeOutboundReply', () => {
  it('removes quoted thread content and signatures before learning', () => {
    const result = sanitizeOutboundReply(
      [
        'Hi Maya,',
        '',
        'That works for me. I can take care of it tomorrow morning.',
        '',
        'Best,',
        'Sam',
        '',
        'On Tue, Jun 9, Maya wrote:',
        '> can you send this over?',
      ].join('\n')
    )

    expect(result).toContain('That works for me')
    expect(result).not.toContain('On Tue')
    expect(result).not.toContain('> can you')
  })

  it('skips empty, automated, and no-reply style messages', () => {
    expect(sanitizeOutboundReply('   ')).toBeNull()
    expect(sanitizeOutboundReply('This is an automated notification.')).toBeNull()
    expect(sanitizeOutboundReply('Please do not reply to this email.')).toBeNull()
  })
})

describe('collectOutboundReplySamples', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads only outbound messages scoped to the requested tenant and channel', async () => {
    mockMessageFindMany.mockResolvedValue([
      { body: 'Hi, I can help with that.', createdAt: new Date('2026-06-01T12:00:00Z') },
      { body: 'On Tue, someone wrote:\n> old quoted text', createdAt: new Date('2026-06-02T12:00:00Z') },
    ])

    const samples = await collectOutboundReplySamples({
      tenantId: 'tenant-A',
      channelId: 'channel-1',
      limit: 10,
    })

    expect(mockMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          direction: 'outbound',
          conversation: { tenantId: 'tenant-A', channelId: 'channel-1' },
        },
      })
    )
    expect(samples).toEqual([
      { text: 'Hi, I can help with that.', createdAt: new Date('2026-06-01T12:00:00Z') },
    ])
  })
})

const mockSummarizeResult = {
  styleSummaryJson: { tone: 'warm', averageLength: 'short' },
  exampleSnippetsJson: ['Hey Alex, sounds good.'],
  sourceStatsJson: { sampleCount: 1 },
  promptVersion: 'reply-learning-v1',
  model: 'gpt-test',
  estimatedInputTokens: 30,
  estimatedOutputTokens: 20,
}

function makeBody(index: number) {
  return `Hey Alex, sounds good. I will send this over today. Sample ${index + 1}.`
}

describe('trainLearnedReplyProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores a compact learned profile instead of raw historical email bodies', async () => {
    mockMessageFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        body: makeBody(index),
        createdAt: new Date(`2026-06-0${index + 1}T12:00:00Z`),
      }))
    )
    mockSummarize.mockResolvedValue(mockSummarizeResult)
    mockProfileFindFirst.mockResolvedValue(null)
    mockProfileCreate.mockResolvedValue({ id: 'profile-1' })
    mockUsageCreate.mockResolvedValue({})
    mockFetchGmailSentSamples.mockResolvedValue([])

    await trainLearnedReplyProfile({
      tenantId: 'tenant-A',
      channelId: 'channel-1',
      profileType: 'business',
    })

    const createData = mockProfileCreate.mock.calls[0][0].data
    expect(createData.styleSummaryJson).toEqual({ tone: 'warm', averageLength: 'short' })
    expect(JSON.stringify(createData)).not.toContain('I will send this over today')
    expect(mockUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-A',
          feature: 'reply_learning.train',
          model: 'gpt-test',
          status: 'completed',
        }),
      })
    )
  })

  it('falls back to Gmail sent history when DB has fewer than 5 samples', async () => {
    // DB returns only 2 messages
    mockMessageFindMany.mockResolvedValue([
      { body: makeBody(0), createdAt: new Date('2026-06-01T12:00:00Z') },
      { body: makeBody(1), createdAt: new Date('2026-06-02T12:00:00Z') },
    ])
    // Gmail SENT returns 5 samples
    mockFetchGmailSentSamples.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        text: `Gmail sent sample ${index + 1}. This is a real email I wrote to someone.`,
        createdAt: new Date(`2026-05-0${index + 1}T12:00:00Z`),
      }))
    )
    mockSummarize.mockResolvedValue(mockSummarizeResult)
    mockProfileFindFirst.mockResolvedValue(null)
    mockProfileCreate.mockResolvedValue({ id: 'profile-2' })
    mockUsageCreate.mockResolvedValue({})

    const result = await trainLearnedReplyProfile({
      tenantId: 'tenant-A',
      channelId: 'channel-1',
      profileType: 'personal',
    })

    expect(mockFetchGmailSentSamples).toHaveBeenCalledWith('channel-1', 60)
    expect(result.fromDb).toBe(2)
    expect(result.fromGmail).toBeGreaterThan(0)
    expect(result.sampleCount).toBeGreaterThanOrEqual(5)
  })

  it('throws with informative message when both DB and Gmail have fewer than 5 usable samples', async () => {
    mockMessageFindMany.mockResolvedValue([
      { body: makeBody(0), createdAt: new Date('2026-06-01T12:00:00Z') },
    ])
    mockFetchGmailSentSamples.mockResolvedValue([
      { text: 'Short.', createdAt: new Date() }, // too short, will be filtered by sanitize
      { text: 'Ok', createdAt: new Date() },
    ])

    await expect(
      trainLearnedReplyProfile({ tenantId: 'tenant-A', channelId: 'channel-1', profileType: 'business' })
    ).rejects.toThrow(/Not enough sent emails/)

    // Error should mention Gmail was checked
    await expect(
      trainLearnedReplyProfile({ tenantId: 'tenant-A', channelId: 'channel-1', profileType: 'business' })
    ).rejects.toThrow(/Gmail sent history/)
  })

  it('does not call fetchGmailSentSamples when DB already has 5+ samples', async () => {
    mockMessageFindMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        body: makeBody(index),
        createdAt: new Date(`2026-06-0${index + 1}T12:00:00Z`),
      }))
    )
    mockSummarize.mockResolvedValue(mockSummarizeResult)
    mockProfileFindFirst.mockResolvedValue(null)
    mockProfileCreate.mockResolvedValue({ id: 'profile-3' })
    mockUsageCreate.mockResolvedValue({})

    await trainLearnedReplyProfile({ tenantId: 'tenant-A', channelId: 'channel-1', profileType: 'business' })

    expect(mockFetchGmailSentSamples).not.toHaveBeenCalled()
  })
})
