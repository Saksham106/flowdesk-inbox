import { describe, it, expect } from 'vitest'

import {
  buildExplainThreadPrompt,
  normalizeExplainThreadOutput,
} from '@/lib/ai/prompts/explain-thread'

const MESSAGES = [
  {
    direction: 'inbound',
    body: 'Hi, can you send the contract by Thursday and confirm the setup fee?',
    createdAt: new Date('2026-06-09T10:00:00Z'),
  },
  {
    direction: 'outbound',
    body: "Sure, I'll send it over tomorrow.",
    createdAt: new Date('2026-06-09T11:00:00Z'),
  },
]

// ---------------------------------------------------------------------------
// buildExplainThreadPrompt
// ---------------------------------------------------------------------------

describe('buildExplainThreadPrompt', () => {
  it('includes contact, status, and messages with directions', () => {
    const prompt = buildExplainThreadPrompt({
      contactName: 'Sarah Patel',
      conversationStatus: 'needs_reply',
      messages: MESSAGES,
    })

    expect(prompt).toContain('Contact: Sarah Patel')
    expect(prompt).toContain('Conversation status: needs_reply')
    expect(prompt).toContain('INBOUND: Hi, can you send the contract')
    expect(prompt).toContain("OUTBOUND: Sure, I'll send it over tomorrow.")
    expect(prompt).toContain('Return only JSON')
  })

  it('handles a missing contact name', () => {
    const prompt = buildExplainThreadPrompt({ messages: MESSAGES })
    expect(prompt).toContain('Contact: Unknown')
  })

  it('truncates very long message bodies', () => {
    const prompt = buildExplainThreadPrompt({
      messages: [
        { direction: 'inbound', body: 'x'.repeat(5000), createdAt: new Date() },
      ],
    })
    expect(prompt).not.toContain('x'.repeat(2600))
    expect(prompt).toContain('...')
  })

  it('keeps only the most recent 25 messages', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      direction: 'inbound',
      body: `message-number-${i}`,
      createdAt: new Date(),
    }))
    const prompt = buildExplainThreadPrompt({ messages: many })
    expect(prompt).not.toContain('message-number-0')
    expect(prompt).toContain('message-number-29')
  })
})

// ---------------------------------------------------------------------------
// normalizeExplainThreadOutput
// ---------------------------------------------------------------------------

describe('normalizeExplainThreadOutput', () => {
  const valid = {
    whatHappened: 'They asked for a contract; you promised to send it.',
    whatTheyWant: 'The contract and the setup fee confirmed.',
    whatYouNeedToDo: ['Send the contract', 'Confirm the setup fee'],
    risks: ['You promised delivery by Thursday'],
    riskLevel: 'medium',
    suggestedNextStep: 'Send the contract today.',
  }

  it('parses a valid response', () => {
    const result = normalizeExplainThreadOutput(JSON.stringify(valid), 'test-model')

    expect(result.whatHappened).toBe(valid.whatHappened)
    expect(result.whatYouNeedToDo).toEqual(valid.whatYouNeedToDo)
    expect(result.risks).toEqual(valid.risks)
    expect(result.riskLevel).toBe('medium')
    expect(result.suggestedNextStep).toBe(valid.suggestedNextStep)
    expect(result.model).toBe('test-model')
  })

  it('throws on invalid JSON', () => {
    expect(() => normalizeExplainThreadOutput('not json', 'm')).toThrow(
      'AI response was not valid JSON'
    )
  })

  it('throws when whatHappened is missing', () => {
    expect(() =>
      normalizeExplainThreadOutput(JSON.stringify({ ...valid, whatHappened: '' }), 'm')
    ).toThrow('whatHappened')
  })

  it('defaults riskLevel to medium for unknown values', () => {
    const result = normalizeExplainThreadOutput(
      JSON.stringify({ ...valid, riskLevel: 'catastrophic' }),
      'm'
    )
    expect(result.riskLevel).toBe('medium')
  })

  it('filters non-string and empty array items', () => {
    const result = normalizeExplainThreadOutput(
      JSON.stringify({ ...valid, whatYouNeedToDo: ['ok', 42, '  ', null], risks: 'not-array' }),
      'm'
    )
    expect(result.whatYouNeedToDo).toEqual(['ok'])
    expect(result.risks).toEqual([])
  })

  it('returns null suggestedNextStep when absent or blank', () => {
    const result = normalizeExplainThreadOutput(
      JSON.stringify({ ...valid, suggestedNextStep: '   ' }),
      'm'
    )
    expect(result.suggestedNextStep).toBeNull()
  })
})
