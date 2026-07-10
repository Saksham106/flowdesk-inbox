import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks (for orchestration tests at the bottom of this file)
// ---------------------------------------------------------------------------
const {
  mockLeadFindFirst,
  mockLeadUpdateMany,
  mockAuditCreate,
  mockAiUsageCreate,
  mockScoreLead,
  mockUserFindFirst,
} = vi.hoisted(() => ({
  mockLeadFindFirst:          vi.fn(),
  mockLeadUpdateMany:         vi.fn(),
  mockAuditCreate:            vi.fn(),
  mockAiUsageCreate:          vi.fn(),
  mockScoreLead:              vi.fn(),
  mockUserFindFirst:          vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead:         { findFirst: mockLeadFindFirst, updateMany: mockLeadUpdateMany },
    auditLog:     { create: mockAuditCreate },
    aiUsageEvent: { create: mockAiUsageCreate },
    user:         { findFirst: mockUserFindFirst },
  },
}))

vi.mock('@/lib/ai/provider', () => ({
  scoreLead: mockScoreLead,
}))

import {
  buildLeadScoringPrompt,
  normalizeLeadScoringOutput,
} from '@/lib/ai/prompts/lead-scoring'

const HIGH_INTENT_MESSAGES = [
  {
    direction: 'inbound',
    body: "Hi, we're evaluating vendors for AI reception at our dental clinic. We have a $2k/month budget. Can we book a demo this week?",
    createdAt: new Date('2026-06-09T10:00:00Z'),
  },
  {
    direction: 'outbound',
    body: "Absolutely! I'd love to show you the product. Are you free Thursday at 2pm?",
    createdAt: new Date('2026-06-09T11:00:00Z'),
  },
]

const WEAK_SIGNAL_MESSAGES = [
  {
    direction: 'inbound',
    body: 'Do you do dental stuff?',
    createdAt: new Date('2026-06-09T10:00:00Z'),
  },
]

// ---------------------------------------------------------------------------
// buildLeadScoringPrompt
// ---------------------------------------------------------------------------

describe('buildLeadScoringPrompt', () => {
  it('includes messages with direction labels', () => {
    const prompt = buildLeadScoringPrompt({ messages: HIGH_INTENT_MESSAGES })
    expect(prompt).toContain('INBOUND:')
    expect(prompt).toContain('OUTBOUND:')
    expect(prompt).toContain('dental clinic')
  })

  it('includes scoring rubric', () => {
    const prompt = buildLeadScoringPrompt({ messages: HIGH_INTENT_MESSAGES })
    expect(prompt).toContain('80-100')
    expect(prompt).toContain('Explicit intent')
  })

  it('includes existing context fields when provided', () => {
    const prompt = buildLeadScoringPrompt({
      messages: HIGH_INTENT_MESSAGES,
      existingNeed: 'AI receptionist',
      existingUrgency: 'high',
      existingBudgetClue: '$2k/month',
    })
    expect(prompt).toContain('Previously extracted need: AI receptionist')
    expect(prompt).toContain('Previously extracted urgency: high')
    expect(prompt).toContain('Previously extracted budget clue: $2k/month')
  })

  it('omits context section when no existing fields are provided', () => {
    const prompt = buildLeadScoringPrompt({ messages: WEAK_SIGNAL_MESSAGES })
    expect(prompt).not.toContain('Previously extracted')
  })

  it('keeps only the most recent 20 messages', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      direction: 'inbound',
      body: `message-number-${i}`,
      createdAt: new Date(),
    }))
    const prompt = buildLeadScoringPrompt({ messages: many })
    expect(prompt).toContain('message-number-24')
    expect(prompt).not.toContain('message-number-4')
  })

  it('truncates long message bodies to 300 chars', () => {
    const prompt = buildLeadScoringPrompt({
      messages: [{ direction: 'inbound', body: 'x'.repeat(500), createdAt: new Date() }],
    })
    expect(prompt).not.toContain('x'.repeat(310))
    expect(prompt).toContain('...')
  })
})

// ---------------------------------------------------------------------------
// normalizeLeadScoringOutput
// ---------------------------------------------------------------------------

describe('normalizeLeadScoringOutput', () => {
  it('returns a valid result from a well-formed response', () => {
    const raw = JSON.stringify({
      score: 85,
      scoreExplanation: 'High-intent lead with budget and demo request.',
      estimatedValue: 2000,
      need: 'AI receptionist for dental clinic',
      urgency: 'high',
      budgetClue: '$2k/month',
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(85)
    expect(result.scoreExplanation).toBe('High-intent lead with budget and demo request.')
    expect(result.estimatedValue).toBe(2000)
    expect(result.urgency).toBe('high')
    expect(result.budgetClue).toBe('$2k/month')
    expect(result.model).toBe('gpt-5.4-mini')
  })

  it('clamps score to 1–100', () => {
    const raw = JSON.stringify({
      score: 150,
      scoreExplanation: 'Over the limit.',
      estimatedValue: null,
      need: 'test',
      urgency: 'medium',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(100)
  })

  it('clamps score minimum to 1', () => {
    const raw = JSON.stringify({
      score: -5,
      scoreExplanation: 'Very weak signal.',
      estimatedValue: null,
      need: 'test',
      urgency: 'low',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.score).toBe(1)
  })

  it('returns null estimatedValue when value is 0 or null', () => {
    const raw = JSON.stringify({
      score: 30,
      scoreExplanation: 'Weak signal.',
      estimatedValue: 0,
      need: 'test',
      urgency: 'low',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.estimatedValue).toBeNull()
  })

  it('falls back to "medium" urgency for unknown values', () => {
    const raw = JSON.stringify({
      score: 50,
      scoreExplanation: 'Some interest.',
      estimatedValue: null,
      need: 'test',
      urgency: 'unknown-value',
      budgetClue: null,
    })
    const result = normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')
    expect(result.urgency).toBe('medium')
  })

  it('throws on invalid JSON', () => {
    expect(() => normalizeLeadScoringOutput('not json', 'gpt-5.4-mini')).toThrow(
      'AI response was not valid JSON'
    )
  })

  it('throws when scoreExplanation is missing', () => {
    const raw = JSON.stringify({ score: 50, estimatedValue: null, need: 'test', urgency: 'low', budgetClue: null })
    expect(() => normalizeLeadScoringOutput(raw, 'gpt-5.4-mini')).toThrow(
      'AI response did not include scoreExplanation'
    )
  })
})

// ---------------------------------------------------------------------------
// shouldRescoreLead
// ---------------------------------------------------------------------------

import { shouldRescoreLead, scoreLeadForConversation } from '@/lib/agent/lead-scoring'

describe('shouldRescoreLead', () => {
  it('returns true when scoredAt is null', () => {
    expect(shouldRescoreLead(null, new Date())).toBe(true)
  })

  it('returns true when conversation has new messages since last score', () => {
    const scoredAt = new Date('2026-06-10T10:00:00Z')
    const lastMessageAt = new Date('2026-06-11T12:00:00Z')
    expect(shouldRescoreLead(scoredAt, lastMessageAt)).toBe(true)
  })

  it('returns false when no new messages since last score', () => {
    const scoredAt = new Date('2026-06-11T12:00:00Z')
    const lastMessageAt = new Date('2026-06-10T10:00:00Z')
    expect(shouldRescoreLead(scoredAt, lastMessageAt)).toBe(false)
  })

  it('returns false when scoredAt equals lastMessageAt', () => {
    const ts = new Date('2026-06-11T12:00:00Z')
    expect(shouldRescoreLead(ts, ts)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// scoreLeadForConversation
// ---------------------------------------------------------------------------

describe('scoreLeadForConversation', () => {
  const TENANT = 'tenant-1'
  const LEAD_ID = 'lead-1'
  const NOW = new Date('2026-06-11T12:00:00Z')
  const YESTERDAY = new Date('2026-06-10T12:00:00Z')

  const MOCK_LEAD = {
    id: LEAD_ID,
    tenantId: TENANT,
    need: 'AI receptionist',
    urgency: 'medium',
    budgetClue: null,
    scoredAt: null,
    conversation: {
      lastMessageAt: NOW,
      messages: [
        { direction: 'inbound', body: 'Do you offer dental AI?', createdAt: NOW },
      ],
    },
  }

  const MOCK_RESULT = {
    score: 82,
    scoreExplanation: 'Demo request with named budget.',
    estimatedValue: 2000,
    need: 'AI receptionist for dental clinic',
    urgency: 'high' as const,
    budgetClue: '$2k/month',
    model: 'gpt-5.4-mini',
  }

  const OWNER = { id: 'owner-1', email: 'owner@example.com' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadFindFirst.mockResolvedValue(MOCK_LEAD)
    mockScoreLead.mockResolvedValue(MOCK_RESULT)
    mockLeadUpdateMany.mockResolvedValue({ count: 1 })
    mockAuditCreate.mockResolvedValue({})
    mockAiUsageCreate.mockResolvedValue({})
    mockUserFindFirst.mockResolvedValue(OWNER)
  })

  it('calls scoreLead with aiContext and updates the lead when scoredAt is null', async () => {
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).toHaveBeenCalledOnce()
    expect(mockScoreLead).toHaveBeenCalledWith(
      expect.objectContaining({
        aiContext: { tenantId: TENANT, userId: OWNER.id, userEmail: OWNER.email },
      })
    )
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: LEAD_ID, tenantId: TENANT },
      data: expect.objectContaining({
        score: 82,
        scoreExplanation: 'Demo request with named budget.',
        estimatedValue: 2000,
      }),
    })
  })

  it('skips scoring when no new messages since last score', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...MOCK_LEAD,
      scoredAt: NOW,
      conversation: { ...MOCK_LEAD.conversation, lastMessageAt: YESTERDAY },
    })
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).not.toHaveBeenCalled()
    expect(mockLeadUpdateMany).not.toHaveBeenCalled()
  })

  it('force option bypasses the re-scoring guard', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...MOCK_LEAD,
      scoredAt: NOW,
      conversation: { ...MOCK_LEAD.conversation, lastMessageAt: YESTERDAY },
    })
    await scoreLeadForConversation(TENANT, LEAD_ID, { force: true })
    expect(mockScoreLead).toHaveBeenCalledOnce()
  })

  it('does not update the lead if scoreLead throws', async () => {
    mockScoreLead.mockRejectedValue(new Error('OpenAI error'))
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockLeadUpdateMany).not.toHaveBeenCalled()
  })

  it('does not update the lead when scoreLead rejects (e.g. AI budget exceeded)', async () => {
    mockScoreLead.mockRejectedValue(new Error('Daily AI spend limit reached'))

    await scoreLeadForConversation(TENANT, LEAD_ID)

    expect(mockLeadUpdateMany).not.toHaveBeenCalled()
  })

  it('does not call scoreLead when the tenant has no user to attribute the AI call to, and records an observable AiUsageEvent', async () => {
    mockUserFindFirst.mockResolvedValue(null)
    mockAiUsageCreate.mockResolvedValue({})

    await scoreLeadForConversation(TENANT, LEAD_ID)

    expect(mockScoreLead).not.toHaveBeenCalled()
    expect(mockLeadUpdateMany).not.toHaveBeenCalled()
    expect(mockAiUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          feature: 'lead.score',
          status: 'skipped',
          errorMessage: 'No tenant owner found for lead scoring',
        }),
      })
    )
  })

  it('returns immediately when the lead is not found', async () => {
    mockLeadFindFirst.mockResolvedValue(null)
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockScoreLead).not.toHaveBeenCalled()
  })

  it('writes an audit log entry on success', async () => {
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        action: 'lead.scored',
      }),
    })
  })

  it('falls back to existing budgetClue when LLM returns null', async () => {
    mockScoreLead.mockResolvedValue({ ...MOCK_RESULT, budgetClue: null })
    mockLeadFindFirst.mockResolvedValue({ ...MOCK_LEAD, budgetClue: 'existing clue' })
    await scoreLeadForConversation(TENANT, LEAD_ID)
    expect(mockLeadUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ budgetClue: 'existing clue' }),
      })
    )
  })
})
