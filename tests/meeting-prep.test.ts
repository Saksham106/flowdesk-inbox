import { describe, it, expect } from 'vitest'
import {
  buildMeetingPrepPrompt,
  normalizeMeetingPrepOutput,
  type MeetingPrepAttendee,
} from '@/lib/ai/prompts/meeting-prep'
import {
  buildMeetingFollowUpPrompt,
  normalizeMeetingFollowUpOutput,
} from '@/lib/ai/prompts/meeting-follow-up'

const EVENT_TITLE = 'Discovery call with ABC Dental'
const EVENT_START = new Date('2026-06-12T14:00:00Z')

const ATTENDEE_WITH_HISTORY: MeetingPrepAttendee = {
  email: 'dr.smith@abcdental.com',
  name: 'Dr. Smith',
  personMemory: {
    summary: 'Dr. Smith — 4 messages across 2 conversations. You have replied 2 times.',
    preferences: '• prefers morning appointments',
    openQuestions: '• What is the pricing for the premium package?',
    promisedActions: "• I'll send over the pricing sheet by Friday.",
  },
  recentMessages: [
    {
      direction: 'inbound',
      body: 'Can you clarify what the onboarding looks like?',
      createdAt: new Date('2026-06-10T09:00:00Z'),
    },
    {
      direction: 'outbound',
      body: 'Happy to walk you through it on the call.',
      createdAt: new Date('2026-06-10T10:00:00Z'),
    },
  ],
}

const ATTENDEE_NO_HISTORY: MeetingPrepAttendee = {
  email: 'new@contact.com',
  name: 'New Contact',
  personMemory: null,
  recentMessages: [],
}

// ---------------------------------------------------------------------------
// buildMeetingPrepPrompt
// ---------------------------------------------------------------------------

describe('buildMeetingPrepPrompt', () => {
  it('includes event title and scheduled time', () => {
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [ATTENDEE_WITH_HISTORY],
    })
    expect(prompt).toContain(`Meeting: ${EVENT_TITLE}`)
    expect(prompt).toContain(EVENT_START.toISOString())
  })

  it('includes attendee name, email, and memory fields', () => {
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [ATTENDEE_WITH_HISTORY],
    })
    expect(prompt).toContain('Dr. Smith <dr.smith@abcdental.com>')
    expect(prompt).toContain('prefers morning appointments')
    expect(prompt).toContain('pricing for the premium package')
    expect(prompt).toContain('pricing sheet by Friday')
  })

  it('includes recent messages with directions', () => {
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [ATTENDEE_WITH_HISTORY],
    })
    expect(prompt).toContain('INBOUND: Can you clarify')
    expect(prompt).toContain('OUTBOUND: Happy to walk you through')
  })

  it('shows no-prior-history message for attendees without memory', () => {
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [ATTENDEE_NO_HISTORY],
    })
    expect(prompt).toContain('No prior email history with this attendee.')
  })

  it('includes Return only JSON instruction', () => {
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [],
    })
    expect(prompt).toContain('Return only JSON')
  })

  it('truncates very long message bodies', () => {
    const longAttendee: MeetingPrepAttendee = {
      ...ATTENDEE_NO_HISTORY,
      recentMessages: [{ direction: 'inbound', body: 'x'.repeat(1000), createdAt: new Date() }],
    }
    const prompt = buildMeetingPrepPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      attendees: [longAttendee],
    })
    expect(prompt).not.toContain('x'.repeat(500))
    expect(prompt).toContain('...')
  })
})

// ---------------------------------------------------------------------------
// normalizeMeetingPrepOutput
// ---------------------------------------------------------------------------

describe('normalizeMeetingPrepOutput', () => {
  const valid = {
    contactSummary: 'Dr. Smith is a returning prospect interested in the premium package.',
    whatTheyAskedAbout: ['Pricing', 'Onboarding process'],
    lastTone: 'warm and professional',
    talkingPoints: ['Walk through onboarding timeline', 'Send pricing sheet follow-up'],
    openItems: ['Promised pricing sheet by Friday'],
    riskFlags: [],
  }

  it('parses a valid response', () => {
    const result = normalizeMeetingPrepOutput(JSON.stringify(valid), 'test-model')
    expect(result.contactSummary).toBe(valid.contactSummary)
    expect(result.whatTheyAskedAbout).toEqual(valid.whatTheyAskedAbout)
    expect(result.lastTone).toBe('warm and professional')
    expect(result.talkingPoints).toEqual(valid.talkingPoints)
    expect(result.openItems).toEqual(valid.openItems)
    expect(result.riskFlags).toEqual([])
    expect(result.model).toBe('test-model')
  })

  it('throws on invalid JSON', () => {
    expect(() => normalizeMeetingPrepOutput('not json', 'm')).toThrow(
      'AI response was not valid JSON'
    )
  })

  it('throws when contactSummary is missing', () => {
    expect(() =>
      normalizeMeetingPrepOutput(JSON.stringify({ ...valid, contactSummary: '' }), 'm')
    ).toThrow('contactSummary')
  })

  it('defaults lastTone to "unknown" when blank', () => {
    const result = normalizeMeetingPrepOutput(
      JSON.stringify({ ...valid, lastTone: '  ' }),
      'm'
    )
    expect(result.lastTone).toBe('unknown')
  })

  it('filters non-string items from arrays', () => {
    const result = normalizeMeetingPrepOutput(
      JSON.stringify({ ...valid, talkingPoints: ['Send invoice', 42, null, ''], riskFlags: 'not-array' }),
      'm'
    )
    expect(result.talkingPoints).toEqual(['Send invoice'])
    expect(result.riskFlags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildMeetingFollowUpPrompt
// ---------------------------------------------------------------------------

describe('buildMeetingFollowUpPrompt', () => {
  it('includes event title and user notes', () => {
    const prompt = buildMeetingFollowUpPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      userNotes: 'Discussed pricing. Dr. Smith will sign next week.',
      attendees: [{ email: 'dr.smith@abcdental.com', name: 'Dr. Smith', personMemory: null }],
    })
    expect(prompt).toContain(EVENT_TITLE)
    expect(prompt).toContain('Discussed pricing. Dr. Smith will sign next week.')
    expect(prompt).toContain('Dr. Smith <dr.smith@abcdental.com>')
  })

  it('uses fallback text when notes are empty', () => {
    const prompt = buildMeetingFollowUpPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      userNotes: '',
      attendees: [],
    })
    expect(prompt).toContain('No notes provided')
  })

  it('includes relationship context from personMemory', () => {
    const prompt = buildMeetingFollowUpPrompt({
      eventTitle: EVENT_TITLE,
      eventStart: EVENT_START,
      userNotes: 'Good call.',
      attendees: [
        {
          email: 'dr.smith@abcdental.com',
          name: 'Dr. Smith',
          personMemory: {
            summary: '4 messages, returning prospect',
            preferences: 'morning only',
          },
        },
      ],
    })
    expect(prompt).toContain('returning prospect')
    expect(prompt).toContain('morning only')
  })
})

// ---------------------------------------------------------------------------
// normalizeMeetingFollowUpOutput
// ---------------------------------------------------------------------------

describe('normalizeMeetingFollowUpOutput', () => {
  const valid = {
    subject: 'Follow-up: Discovery call with ABC Dental',
    body: 'Hi Dr. Smith,\n\nThank you for the call today...',
  }

  it('parses a valid response', () => {
    const result = normalizeMeetingFollowUpOutput(JSON.stringify(valid), 'test-model')
    expect(result.subject).toBe(valid.subject)
    expect(result.body).toBe(valid.body)
    expect(result.model).toBe('test-model')
  })

  it('throws on invalid JSON', () => {
    expect(() => normalizeMeetingFollowUpOutput('bad', 'm')).toThrow(
      'AI response was not valid JSON'
    )
  })

  it('throws when subject or body is missing', () => {
    expect(() =>
      normalizeMeetingFollowUpOutput(JSON.stringify({ subject: '', body: 'Some body' }), 'm')
    ).toThrow('subject or body')
    expect(() =>
      normalizeMeetingFollowUpOutput(JSON.stringify({ subject: 'Hi', body: '' }), 'm')
    ).toThrow('subject or body')
  })
})
