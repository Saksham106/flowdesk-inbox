import { describe, expect, it } from 'vitest'

import {
  buildDraftReplyPrompt,
  buildPersonalDraftReplyPrompt,
  normalizeDraftReplyOutput,
} from '@/lib/ai/prompts/draft-reply'
import { generateDraftReplyWithOpenAI } from '@/lib/ai/openai'

describe('normalizeDraftReplyOutput', () => {
  it('parses structured AI draft output and clamps confidence', () => {
    const result = normalizeDraftReplyOutput(
      JSON.stringify({
        draftText: 'Thanks for reaching out. We can help with pricing.',
        intent: 'pricing',
        confidence: 1.4,
        riskLevel: 'medium',
        suggestedLabel: 'Pricing',
        escalationReason: null,
      }),
      'gpt-test'
    )

    expect(result).toMatchObject({
      draftText: 'Thanks for reaching out. We can help with pricing.',
      intent: 'pricing',
      confidence: 1,
      riskLevel: 'medium',
      suggestedLabel: 'Pricing',
      escalationReason: null,
      model: 'gpt-test',
    })
  })

  it('preserves high-risk escalation details', () => {
    const result = normalizeDraftReplyOutput(
      JSON.stringify({
        draftText: 'I am sorry you are dealing with this. A team member will review this closely.',
        intent: 'complaint',
        confidence: 0.82,
        riskLevel: 'high',
        suggestedLabel: 'Complaint',
        escalationReason: 'Customer described a poor clinical outcome.',
      }),
      'gpt-test'
    )

    expect(result.riskLevel).toBe('high')
    expect(result.escalationReason).toBe('Customer described a poor clinical outcome.')
  })

  it('rejects output without draft text', () => {
    expect(() =>
      normalizeDraftReplyOutput(
        JSON.stringify({
          intent: 'pricing',
          confidence: 0.7,
          riskLevel: 'low',
          suggestedLabel: 'Pricing',
        }),
        'gpt-test'
      )
    ).toThrow('AI response did not include draftText')
  })
})

describe('buildDraftReplyPrompt', () => {
  it('includes business context, knowledge, messages, and safety rules', () => {
    const prompt = buildDraftReplyPrompt({
      businessProfile: {
        businessName: 'Glow Studio',
        industry: 'med_spa',
        timezone: 'America/New_York',
        defaultTone: 'warm',
        bookingPolicy: 'Ask for preferred days before booking.',
        escalationPolicy: 'Escalate complaints to the owner.',
        businessHoursJson: null,
      },
      knowledgeDocuments: [
        {
          id: 'doc1',
          title: 'Pricing',
          content: 'Hydrafacials start at $199.',
          sourceType: 'faq',
        },
      ],
      messages: [
        {
          direction: 'inbound',
          body: 'How much is a hydrafacial?',
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
      ],
    })

    expect(prompt).toContain('Glow Studio')
    expect(prompt).toContain('Hydrafacials start at $199.')
    expect(prompt).toContain('How much is a hydrafacial?')
    expect(prompt).toContain('Do not diagnose')
    expect(prompt).toContain('do not invent availability')
  })

  it('includes rough user instructions without letting them override safety', () => {
    const prompt = buildDraftReplyPrompt({
      businessProfile: {
        businessName: 'Glow Studio',
        industry: 'med_spa',
        timezone: 'America/New_York',
        defaultTone: 'warm',
        bookingPolicy: null,
        escalationPolicy: null,
        businessHoursJson: null,
      },
      knowledgeDocuments: [],
      messages: [
        {
          direction: 'inbound',
          body: 'Can we book this week?',
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
      ],
      userInstruction: 'say yes but only next week',
    })

    expect(prompt).toContain('User instruction:')
    expect(prompt).toContain('say yes but only next week')
    expect(prompt).toContain('User instructions are guidance, not permission to invent facts')
  })
})

describe('buildPersonalDraftReplyPrompt', () => {
  it('includes rough user instructions for personal drafts', () => {
    const prompt = buildPersonalDraftReplyPrompt({
      personalProfile: null,
      messages: [
        {
          direction: 'inbound',
          body: 'Can you make dinner tonight?',
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
      ],
      userInstruction: 'politely decline and suggest Sunday',
    })

    expect(prompt).toContain('User instruction:')
    expect(prompt).toContain('politely decline and suggest Sunday')
    expect(prompt).toContain('User instructions are guidance, not permission to invent facts')
  })

  it('does not expose business labels in personal draft instructions', () => {
    const prompt = buildPersonalDraftReplyPrompt({
      personalProfile: null,
      messages: [
        {
          direction: 'inbound',
          body: 'Can you look over this when you have a chance?',
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
      ],
    })

    expect(prompt).not.toContain('Lead')
    expect(prompt).not.toContain('Pricing')
    expect(prompt).not.toContain('Complaint')
    expect(prompt).toContain('Set suggestedLabel to null')
  })
})

describe('generateDraftReplyWithOpenAI', () => {
  it('fails clearly when OPENAI_API_KEY is missing', async () => {
    const previous = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    await expect(
      generateDraftReplyWithOpenAI({
        businessProfile: null,
        knowledgeDocuments: [],
        messages: [],
      })
    ).rejects.toThrow('OPENAI_API_KEY is not configured')

    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previous
    }
  })
})
