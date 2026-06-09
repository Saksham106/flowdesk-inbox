import { describe, expect, it } from 'vitest'

import {
  buildDraftReplyPrompt,
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
    expect(prompt).toContain('Do not claim calendar availability')
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
