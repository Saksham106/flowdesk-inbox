# Meeting Prep + Post-Meeting Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/meetings` page that generates on-demand prep briefs from email history before meetings, and post-meeting follow-up drafts queued for approval — plus a "Meetings Today" card in the digest.

**Architecture:** Two new AI prompt/normalizer pairs (same pattern as `explain-thread`), two new API routes, a server-rendered `/meetings` page with client `MeetingCard` components, a digest section, and a nav link. No schema changes required — follow-up drafts flow into the existing `Draft` + `ApprovalRequest` models.

**Tech Stack:** Next.js 14 App Router, Prisma, OpenAI structured output, Vitest, Tailwind CSS, googleapis

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/ai/prompts/meeting-prep.ts` | `MeetingPrepResult` type, JSON schema, prompt builder, normalizer |
| Create | `lib/ai/prompts/meeting-follow-up.ts` | `MeetingFollowUpResult` type, JSON schema, prompt builder, normalizer |
| Modify | `lib/ai/openai.ts` | Add `generateMeetingPrepWithOpenAI`, `generateMeetingFollowUpWithOpenAI` |
| Modify | `lib/ai/provider.ts` | Export `generateMeetingPrep`, `generateMeetingFollowUp` |
| Modify | `lib/google.ts` | Add optional `timeMax` param to `listEvents` |
| Create | `app/api/meetings/prep/route.ts` | POST — load attendee context, call prep LLM, audit |
| Create | `app/api/meetings/follow-up/route.ts` | POST — generate follow-up, upsert draft, create ApprovalRequest |
| Create | `app/meetings/page.tsx` | Server: fetch calendar events + credential, render cards |
| Create | `app/meetings/MeetingBriefView.tsx` | Display-only: renders `MeetingPrepResult` sections |
| Create | `app/meetings/MeetingCard.tsx` | Client: prep + follow-up interaction state machine |
| Create | `app/digest/MeetingsTodaySection.tsx` | Server: compact today's meetings list linking to /meetings |
| Modify | `app/digest/page.tsx` | Fetch today's calendar events, render `MeetingsTodaySection` |
| Modify | `app/inbox/page.tsx` | Add "Meetings" nav link in desktop + mobile nav |
| Modify | `docs/MASTER_PRODUCT_PLAN.md` | Update feature status + decision log |
| Create | `tests/meeting-prep.test.ts` | Unit tests for prompt builders and normalizers |

---

## Task 1: Prompt types, builders, and normalizers

**Files:**
- Create: `lib/ai/prompts/meeting-prep.ts`
- Create: `lib/ai/prompts/meeting-follow-up.ts`
- Create: `tests/meeting-prep.test.ts`

- [ ] **Step 1: Write `lib/ai/prompts/meeting-prep.ts`**

```typescript
const RISK_LEVELS = ["low", "medium", "high"] as const

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export type MeetingPrepResult = {
  contactSummary: string
  whatTheyAskedAbout: string[]
  lastTone: string
  talkingPoints: string[]
  openItems: string[]
  riskFlags: string[]
  model: string
}

export type MeetingPrepAttendee = {
  email: string
  name: string | null
  personMemory: {
    summary: string
    preferences: string | null
    openQuestions: string | null
    promisedActions: string | null
  } | null
  recentMessages: Array<{ direction: string; body: string; createdAt: Date }>
}

export type MeetingPrepPromptInput = {
  eventTitle: string
  eventStart: Date
  attendees: MeetingPrepAttendee[]
}

export const meetingPrepJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contactSummary",
    "whatTheyAskedAbout",
    "lastTone",
    "talkingPoints",
    "openItems",
    "riskFlags",
  ],
  properties: {
    contactSummary: { type: "string" },
    whatTheyAskedAbout: { type: "array", items: { type: "string" } },
    lastTone: { type: "string" },
    talkingPoints: { type: "array", items: { type: "string" } },
    openItems: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
  },
}

export function buildMeetingPrepPrompt(input: MeetingPrepPromptInput): string {
  const attendeeBlock = input.attendees
    .map((a) => {
      const name = a.name || a.email
      const lines: string[] = [`Attendee: ${name} <${a.email}>`]
      if (a.personMemory) {
        lines.push(`Relationship: ${a.personMemory.summary}`)
        if (a.personMemory.preferences) lines.push(`Preferences: ${a.personMemory.preferences}`)
        if (a.personMemory.openQuestions) lines.push(`Open questions they raised: ${a.personMemory.openQuestions}`)
        if (a.personMemory.promisedActions) lines.push(`Things you promised: ${a.personMemory.promisedActions}`)
      } else {
        lines.push("No prior email history with this attendee.")
      }
      if (a.recentMessages.length > 0) {
        lines.push("Recent messages (oldest first):")
        a.recentMessages.slice(-20).forEach((m) => {
          const ts = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt)
          lines.push(`  ${ts} ${m.direction.toUpperCase()}: ${truncate(m.body, 400)}`)
        })
      }
      return lines.join("\n")
    })
    .join("\n\n---\n\n")

  return [
    "You are FlowDesk's meeting prep assistant. Prepare a concise briefing for a busy user about to join a meeting.",
    "OUTBOUND messages were sent by the user. INBOUND messages were sent by the attendee.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Field guidance:",
    "- contactSummary: 1-2 sentences on who this person is and the relationship status.",
    "- whatTheyAskedAbout: key topics, questions, or requests from prior emails. Empty array if no prior history.",
    "- lastTone: describe the most recent emotional/professional tone in 3-5 words (e.g. 'warm and enthusiastic', 'frustrated about delays', 'new contact, no prior emails').",
    "- talkingPoints: 2-4 specific things the user should bring up or push for in this meeting, based on email history.",
    "- openItems: promises the user made or questions the attendee raised that have not been resolved. Empty if none.",
    "- riskFlags: sensitive topics to handle carefully. Empty array if none.",
    "",
    "Safety rules:",
    "- Do not invent facts not present in the email history.",
    "- If there is no prior history, return empty arrays for whatTheyAskedAbout, talkingPoints, openItems, riskFlags.",
    "",
    `Meeting: ${input.eventTitle}`,
    `Scheduled: ${input.eventStart.toISOString()}`,
    "",
    "Attendee context:",
    attendeeBlock,
  ].join("\n")
}

export function normalizeMeetingPrepOutput(rawText: string, model: string): MeetingPrepResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }
  const r = parsed as Record<string, unknown>
  const contactSummary = asTrimmedString(r.contactSummary)
  if (!contactSummary) throw new Error("AI response did not include contactSummary")
  return {
    contactSummary,
    whatTheyAskedAbout: asStringArray(r.whatTheyAskedAbout),
    lastTone: asTrimmedString(r.lastTone) || "unknown",
    talkingPoints: asStringArray(r.talkingPoints),
    openItems: asStringArray(r.openItems),
    riskFlags: asStringArray(r.riskFlags),
    model,
  }
}
```

- [ ] **Step 2: Write `lib/ai/prompts/meeting-follow-up.ts`**

```typescript
function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export type MeetingFollowUpResult = {
  subject: string
  body: string
  model: string
}

export type MeetingFollowUpAttendee = {
  email: string
  name: string | null
  personMemory: {
    summary: string
    preferences: string | null
  } | null
}

export type MeetingFollowUpPromptInput = {
  eventTitle: string
  eventStart: Date
  userNotes: string
  attendees: MeetingFollowUpAttendee[]
}

export const meetingFollowUpJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
}

export function buildMeetingFollowUpPrompt(input: MeetingFollowUpPromptInput): string {
  const recipientBlock = input.attendees
    .map((a) => {
      const name = a.name || a.email
      const parts = [`${name} <${a.email}>`]
      if (a.personMemory?.summary) parts.push(`Relationship: ${a.personMemory.summary}`)
      if (a.personMemory?.preferences) parts.push(`Preferences: ${a.personMemory.preferences}`)
      return parts.join(" — ")
    })
    .join("\n")

  return [
    "You are FlowDesk's post-meeting assistant. Write a professional follow-up email based on the meeting context and user's notes.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Field guidance:",
    "- subject: a concise email subject line (e.g. 'Follow-up: [meeting title]').",
    "- body: full plain-text email body. Open with a brief thank-you, summarize what was discussed (from user notes), list action items if any, close warmly. Match tone to relationship context.",
    "",
    "Safety rules:",
    "- Only include action items explicitly stated in the user's notes.",
    "- Do not invent commitments or facts.",
    "- Keep it concise — 3-5 short paragraphs maximum.",
    "",
    `Meeting: ${input.eventTitle}`,
    `Date: ${input.eventStart.toISOString()}`,
    "",
    "Recipients:",
    recipientBlock,
    "",
    "User's meeting notes:",
    input.userNotes.trim() || "(No notes provided — write a brief generic thank-you and ask if there are next steps.)",
  ].join("\n")
}

export function normalizeMeetingFollowUpOutput(rawText: string, model: string): MeetingFollowUpResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }
  const r = parsed as Record<string, unknown>
  const subject = asTrimmedString(r.subject)
  const body = asTrimmedString(r.body)
  if (!subject || !body) throw new Error("AI response missing subject or body")
  return { subject, body, model }
}
```

- [ ] **Step 3: Write the failing tests in `tests/meeting-prep.test.ts`**

```typescript
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
    { direction: 'inbound', body: 'Can you clarify what the onboarding looks like?', createdAt: new Date('2026-06-10T09:00:00Z') },
    { direction: 'outbound', body: 'Happy to walk you through it on the call.', createdAt: new Date('2026-06-10T10:00:00Z') },
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
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [ATTENDEE_WITH_HISTORY] })
    expect(prompt).toContain(`Meeting: ${EVENT_TITLE}`)
    expect(prompt).toContain(EVENT_START.toISOString())
  })

  it('includes attendee name, email, and memory fields', () => {
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [ATTENDEE_WITH_HISTORY] })
    expect(prompt).toContain('Dr. Smith <dr.smith@abcdental.com>')
    expect(prompt).toContain('prefers morning appointments')
    expect(prompt).toContain('pricing for the premium package')
    expect(prompt).toContain("pricing sheet by Friday")
  })

  it('includes recent messages with directions', () => {
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [ATTENDEE_WITH_HISTORY] })
    expect(prompt).toContain('INBOUND: Can you clarify')
    expect(prompt).toContain('OUTBOUND: Happy to walk you through')
  })

  it('shows no-prior-history message for attendees without memory', () => {
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [ATTENDEE_NO_HISTORY] })
    expect(prompt).toContain('No prior email history with this attendee.')
  })

  it('includes Return only JSON instruction', () => {
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [] })
    expect(prompt).toContain('Return only JSON')
  })

  it('truncates very long message bodies', () => {
    const longMsg: MeetingPrepAttendee = {
      ...ATTENDEE_NO_HISTORY,
      recentMessages: [{ direction: 'inbound', body: 'x'.repeat(1000), createdAt: new Date() }],
    }
    const prompt = buildMeetingPrepPrompt({ eventTitle: EVENT_TITLE, eventStart: EVENT_START, attendees: [longMsg] })
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
    expect(() => normalizeMeetingPrepOutput('not json', 'm')).toThrow('AI response was not valid JSON')
  })

  it('throws when contactSummary is missing', () => {
    expect(() =>
      normalizeMeetingPrepOutput(JSON.stringify({ ...valid, contactSummary: '' }), 'm')
    ).toThrow('contactSummary')
  })

  it('defaults lastTone to "unknown" when blank', () => {
    const result = normalizeMeetingPrepOutput(JSON.stringify({ ...valid, lastTone: '  ' }), 'm')
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
      attendees: [{
        email: 'dr.smith@abcdental.com',
        name: 'Dr. Smith',
        personMemory: { summary: '4 messages, returning prospect', preferences: 'morning only' },
      }],
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
    expect(() => normalizeMeetingFollowUpOutput('bad', 'm')).toThrow('AI response was not valid JSON')
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
```

- [ ] **Step 4: Run tests — expect them to PASS (prompt files are written first)**

```bash
npx vitest run tests/meeting-prep.test.ts
```

Expected: All tests pass. These are unit tests on pure functions with no mocks.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/meeting-prep.ts lib/ai/prompts/meeting-follow-up.ts tests/meeting-prep.test.ts
git commit -m "feat: add meeting prep and follow-up prompt builders with tests"
```

---

## Task 2: OpenAI functions + provider exports

**Files:**
- Modify: `lib/ai/openai.ts`
- Modify: `lib/ai/provider.ts`

- [ ] **Step 1: Add imports and two new functions to `lib/ai/openai.ts`**

Add these imports at the top of the file, after the existing imports:

```typescript
import {
  buildMeetingPrepPrompt,
  meetingPrepJsonSchema,
  normalizeMeetingPrepOutput,
  type MeetingPrepPromptInput,
  type MeetingPrepResult,
} from "@/lib/ai/prompts/meeting-prep"
import {
  buildMeetingFollowUpPrompt,
  meetingFollowUpJsonSchema,
  normalizeMeetingFollowUpOutput,
  type MeetingFollowUpPromptInput,
  type MeetingFollowUpResult,
} from "@/lib/ai/prompts/meeting-follow-up"
```

Then add these two functions at the end of `lib/ai/openai.ts`:

```typescript
export async function generateMeetingPrepWithOpenAI(
  input: MeetingPrepPromptInput
): Promise<MeetingPrepResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildMeetingPrepPrompt(input)
  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_meeting_prep",
        strict: true,
        schema: meetingPrepJsonSchema,
      },
    },
  })
  return normalizeMeetingPrepOutput(response.output_text, model)
}

export async function generateMeetingFollowUpWithOpenAI(
  input: MeetingFollowUpPromptInput
): Promise<MeetingFollowUpResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildMeetingFollowUpPrompt(input)
  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_meeting_follow_up",
        strict: true,
        schema: meetingFollowUpJsonSchema,
      },
    },
  })
  return normalizeMeetingFollowUpOutput(response.output_text, model)
}
```

- [ ] **Step 2: Add provider exports to `lib/ai/provider.ts`**

Add these imports at the top of `lib/ai/provider.ts`, after the existing imports:

```typescript
import { generateMeetingPrepWithOpenAI, generateMeetingFollowUpWithOpenAI } from "@/lib/ai/openai"
import type { MeetingPrepPromptInput, MeetingPrepResult } from "@/lib/ai/prompts/meeting-prep"
import type { MeetingFollowUpPromptInput, MeetingFollowUpResult } from "@/lib/ai/prompts/meeting-follow-up"
```

Then add these two functions at the end of `lib/ai/provider.ts`:

```typescript
export async function generateMeetingPrep(
  input: MeetingPrepPromptInput
): Promise<MeetingPrepResult> {
  return generateMeetingPrepWithOpenAI(input)
}

export async function generateMeetingFollowUp(
  input: MeetingFollowUpPromptInput
): Promise<MeetingFollowUpResult> {
  return generateMeetingFollowUpWithOpenAI(input)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/openai.ts lib/ai/provider.ts
git commit -m "feat: add generateMeetingPrep and generateMeetingFollowUp to AI provider"
```

---

## Task 3: Extend `listEvents` with optional `timeMax`

**Files:**
- Modify: `lib/google.ts:390-412`

- [ ] **Step 1: Update `listEvents` signature and implementation**

Find the `listEvents` function (around line 390). Replace the function signature and body with:

```typescript
export async function listEvents(
  calendar: ReturnType<typeof google.calendar>,
  {
    maxResults = 20,
    timeMin = new Date(),
    timeMax,
  }: { maxResults?: number; timeMin?: Date; timeMax?: Date } = {}
): Promise<CalendarEvent[]> {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    ...(timeMax ? { timeMax: timeMax.toISOString() } : {}),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(No title)",
    description: e.description ?? undefined,
    start: new Date(e.start?.dateTime ?? e.start?.date ?? Date.now()),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? Date.now()),
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  }));
}
```

- [ ] **Step 2: Verify tests still pass**

```bash
npx vitest run tests/calendar-hold.test.ts
```

Expected: All existing tests pass (this is a non-breaking, additive change).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/google.ts
git commit -m "feat: add optional timeMax param to listEvents"
```

---

## Task 4: `/api/meetings/prep` route

**Files:**
- Create: `app/api/meetings/prep/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { generateMeetingPrep } from "@/lib/ai/provider"
import { buildMeetingPrepPrompt } from "@/lib/ai/prompts/meeting-prep"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import type { MeetingPrepAttendee } from "@/lib/ai/prompts/meeting-prep"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { eventId: _eventId, eventTitle, eventStart, attendeeEmails, calendarEmail } = body as {
    eventId?: string
    eventTitle?: string
    eventStart?: string
    attendeeEmails?: string[]
    calendarEmail?: string
  }

  if (!eventTitle || !eventStart || !Array.isArray(attendeeEmails) || !calendarEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const credential = await prisma.googleCalendarCredential.findUnique({
    where: { tenantId_email: { tenantId, email: calendarEmail } },
  })
  if (!credential) {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 403 })
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      email: { in: attendeeEmails.map((e) => e.toLowerCase()), mode: "insensitive" },
    },
    include: {
      personMemory: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        include: { messages: { orderBy: { createdAt: "asc" }, take: 30 } },
      },
    },
  })

  const contactMap = new Map(contacts.map((c) => [c.email.toLowerCase(), c]))

  const attendees: MeetingPrepAttendee[] = attendeeEmails.map((email) => {
    const contact = contactMap.get(email.toLowerCase())
    if (!contact) return { email, name: null, personMemory: null, recentMessages: [] }
    const recentMessages = contact.conversations
      .flatMap((conv) => conv.messages)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-20)
    return {
      email,
      name: contact.name,
      personMemory: contact.personMemory
        ? {
            summary: contact.personMemory.summary,
            preferences: contact.personMemory.preferences,
            openQuestions: contact.personMemory.openQuestions,
            promisedActions: contact.personMemory.promisedActions,
          }
        : null,
      recentMessages,
    }
  })

  const input = { eventTitle, eventStart: new Date(eventStart), attendees }

  let result: Awaited<ReturnType<typeof generateMeetingPrep>>
  try {
    result = await generateMeetingPrep(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate prep brief"
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502
    await recordAiUsageEvent({
      tenantId,
      feature: "meeting_prep",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      status: "failed",
    })
    return NextResponse.json({ error: message }, { status })
  }

  await recordAiUsageEvent({
    tenantId,
    feature: "meeting_prep",
    model: result.model,
    estimatedInputTokens: estimateTokenCount(buildMeetingPrepPrompt(input)),
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "meeting_prep.generated",
      payloadJson: {
        eventTitle,
        attendeeCount: attendeeEmails.length,
        matchedContactCount: contacts.length,
        model: result.model,
      },
    },
  })

  return NextResponse.json({ brief: result })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/meetings/prep/route.ts
git commit -m "feat: add /api/meetings/prep route"
```

---

## Task 5: `/api/meetings/follow-up` route

**Files:**
- Create: `app/api/meetings/follow-up/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { generateMeetingFollowUp } from "@/lib/ai/provider"
import { buildMeetingFollowUpPrompt } from "@/lib/ai/prompts/meeting-follow-up"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import type { MeetingFollowUpAttendee } from "@/lib/ai/prompts/meeting-follow-up"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { eventTitle, eventStart, attendeeEmails, calendarEmail, userNotes } = body as {
    eventTitle?: string
    eventStart?: string
    attendeeEmails?: string[]
    calendarEmail?: string
    userNotes?: string
  }

  if (!eventTitle || !eventStart || !Array.isArray(attendeeEmails) || !calendarEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const credential = await prisma.googleCalendarCredential.findUnique({
    where: { tenantId_email: { tenantId, email: calendarEmail } },
  })
  if (!credential) {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 403 })
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      email: { in: attendeeEmails.map((e) => e.toLowerCase()), mode: "insensitive" },
    },
    include: {
      personMemory: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
      },
    },
  })

  const contactMap = new Map(contacts.map((c) => [c.email.toLowerCase(), c]))

  const attendees: MeetingFollowUpAttendee[] = attendeeEmails.map((email) => {
    const contact = contactMap.get(email.toLowerCase())
    if (!contact) return { email, name: null, personMemory: null }
    return {
      email,
      name: contact.name,
      personMemory: contact.personMemory
        ? { summary: contact.personMemory.summary, preferences: contact.personMemory.preferences }
        : null,
    }
  })

  const input = {
    eventTitle,
    eventStart: new Date(eventStart),
    userNotes: userNotes || "",
    attendees,
  }

  let result: Awaited<ReturnType<typeof generateMeetingFollowUp>>
  try {
    result = await generateMeetingFollowUp(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate follow-up"
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502
    await recordAiUsageEvent({
      tenantId,
      feature: "meeting_follow_up",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      status: "failed",
    })
    return NextResponse.json({ error: message }, { status })
  }

  await recordAiUsageEvent({
    tenantId,
    feature: "meeting_follow_up",
    model: result.model,
    estimatedInputTokens: estimateTokenCount(buildMeetingFollowUpPrompt(input)),
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

  // Find a conversation to attach the approval to.
  // Draft.conversationId is @unique — upsert replaces any existing draft on that conversation.
  const firstContactWithConversation = contacts.find((c) => c.conversations.length > 0)
  const conversationId = firstContactWithConversation?.conversations[0]?.id ?? null

  let approvalRequestId: string | null = null

  if (conversationId) {
    const draft = await prisma.draft.upsert({
      where: { conversationId },
      create: {
        conversationId,
        text: result.body,
        status: "proposed",
        metadataJson: {
          subject: result.subject,
          source: "meeting_follow_up",
          eventTitle,
        },
      },
      update: {
        text: result.body,
        status: "proposed",
        metadataJson: {
          subject: result.subject,
          source: "meeting_follow_up",
          eventTitle,
        },
      },
    })

    const approval = await prisma.approvalRequest.create({
      data: { tenantId, conversationId, draftId: draft.id },
    })
    approvalRequestId = approval.id
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "meeting_follow_up.draft_created",
      payloadJson: {
        eventTitle,
        approvalRequestId,
        attendeeCount: attendeeEmails.length,
        notesLength: (userNotes || "").length,
      },
    },
  })

  if (approvalRequestId) {
    return NextResponse.json({ approvalRequestId })
  }
  return NextResponse.json({ subject: result.subject, body: result.body })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/meetings/follow-up/route.ts
git commit -m "feat: add /api/meetings/follow-up route"
```

---

## Task 6: Meetings page + client components

**Files:**
- Create: `app/meetings/MeetingBriefView.tsx`
- Create: `app/meetings/MeetingCard.tsx`
- Create: `app/meetings/page.tsx`

- [ ] **Step 1: Create `app/meetings/MeetingBriefView.tsx`**

```tsx
import type { MeetingPrepResult } from "@/lib/ai/prompts/meeting-prep"

export default function MeetingBriefView({ brief }: { brief: MeetingPrepResult }) {
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Who they are</p>
        <p className="mt-1 text-sm text-slate-800">{brief.contactSummary}</p>
        <span className="mt-2 inline-block rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Tone: {brief.lastTone}
        </span>
      </div>

      {brief.whatTheyAskedAbout.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            What they asked about
          </p>
          <ul className="mt-1 space-y-1">
            {brief.whatTheyAskedAbout.map((item, i) => (
              <li key={i} className="text-sm text-slate-800">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.talkingPoints.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Talking points
          </p>
          <ul className="mt-1 space-y-1">
            {brief.talkingPoints.map((item, i) => (
              <li key={i} className="text-sm text-slate-800">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.openItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Open items
          </p>
          <ul className="mt-1 space-y-1">
            {brief.openItems.map((item, i) => (
              <li key={i} className="text-sm text-amber-700">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.riskFlags.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Risk flags
          </p>
          <ul className="mt-1 space-y-1">
            {brief.riskFlags.map((item, i) => (
              <li key={i} className="text-sm text-red-700">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/meetings/MeetingCard.tsx`**

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import MeetingBriefView from "@/app/meetings/MeetingBriefView"
import type { CalendarEvent } from "@/lib/google"
import type { MeetingPrepResult } from "@/lib/ai/prompts/meeting-prep"

type Props = {
  event: CalendarEvent
  calendarEmail: string
  type: "upcoming" | "recent"
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export default function MeetingCard({ event, calendarEmail, type }: Props) {
  const [prepLoading, setPrepLoading] = useState(false)
  const [brief, setBrief] = useState<MeetingPrepResult | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)

  const [notes, setNotes] = useState("")
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [inlineFollowUp, setInlineFollowUp] = useState<{ subject: string; body: string } | null>(null)
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGeneratePrep() {
    setPrepLoading(true)
    setPrepError(null)
    try {
      const res = await fetch("/api/meetings/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventTitle: event.summary,
          eventStart: new Date(event.start).toISOString(),
          attendeeEmails: event.attendees,
          calendarEmail,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error || "Failed to generate prep brief")
      }
      const data = await res.json() as { brief: MeetingPrepResult }
      setBrief(data.brief)
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setPrepLoading(false)
    }
  }

  async function handleGenerateFollowUp() {
    setFollowUpLoading(true)
    setFollowUpError(null)
    try {
      const res = await fetch("/api/meetings/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTitle: event.summary,
          eventStart: new Date(event.start).toISOString(),
          attendeeEmails: event.attendees,
          calendarEmail,
          userNotes: notes,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error || "Failed to generate follow-up")
      }
      const data = await res.json() as { approvalRequestId?: string; subject?: string; body?: string }
      if (data.approvalRequestId) {
        setApprovalId(data.approvalRequestId)
      } else if (data.subject && data.body) {
        setInlineFollowUp({ subject: data.subject, body: data.body })
      }
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setFollowUpLoading(false)
    }
  }

  function handleCopy() {
    if (!inlineFollowUp) return
    navigator.clipboard.writeText(`Subject: ${inlineFollowUp.subject}\n\n${inlineFollowUp.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{event.summary}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDate(event.start)} · {formatTime(event.start)}–{formatTime(event.end)}
            {event.attendees.length > 0 &&
              ` · ${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {type === "upcoming" && (
        <div className="mt-4">
          {!brief && (
            <button
              onClick={handleGeneratePrep}
              disabled={prepLoading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {prepLoading ? "Generating brief..." : "Generate Prep Brief"}
            </button>
          )}
          {prepError && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
              <span>{prepError}</span>
              <button onClick={handleGeneratePrep} className="underline">
                Retry
              </button>
            </div>
          )}
          {brief && <MeetingBriefView brief={brief} />}
        </div>
      )}

      {type === "recent" && (
        <div className="mt-4 space-y-3">
          {!approvalId && !inlineFollowUp && (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What happened? Any decisions or next steps?"
                className="w-full rounded-lg border border-slate-200 p-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                rows={3}
              />
              <button
                onClick={handleGenerateFollowUp}
                disabled={followUpLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {followUpLoading ? "Generating..." : "Generate Follow-up Draft"}
              </button>
            </>
          )}
          {followUpError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <span>{followUpError}</span>
              <button onClick={handleGenerateFollowUp} className="underline">
                Retry
              </button>
            </div>
          )}
          {approvalId && (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Follow-up draft created.{" "}
              <Link href="/approvals" className="font-medium underline">
                Review in Approvals →
              </Link>
            </div>
          )}
          {inlineFollowUp && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Subject
              </p>
              <p className="mb-3 text-sm text-slate-800">{inlineFollowUp.subject}</p>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Body
              </p>
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{inlineFollowUp.body}</pre>
              <button
                onClick={handleCopy}
                className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `app/meetings/page.tsx`**

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getCalendarClient, listEvents } from "@/lib/google"
import MeetingCard from "@/app/meetings/MeetingCard"
import type { CalendarEvent } from "@/lib/google"

export const dynamic = "force-dynamic"

export default async function MeetingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const credential = await prisma.googleCalendarCredential.findFirst({
    where: { tenantId },
  })

  if (!credential) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Meeting Prep</h1>
          <p className="mt-3 text-slate-600">
            Connect Google Calendar to get prep briefs and post-meeting follow-ups.
          </p>
          <Link
            href="/settings"
            className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Go to Settings →
          </Link>
        </div>
      </div>
    )
  }

  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  let upcoming: CalendarEvent[] = []
  let recent: CalendarEvent[] = []
  let fetchError = false

  try {
    const calendar = await getCalendarClient(tenantId, credential.email)
    ;[upcoming, recent] = await Promise.all([
      listEvents(calendar, { timeMin: now, maxResults: 10 }),
      listEvents(calendar, { timeMin: yesterday, timeMax: now, maxResults: 10 }),
    ])
  } catch {
    fetchError = true
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
            ← Inbox
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Meeting Prep</h1>
          <p className="mt-1 text-sm text-slate-500">
            Prep briefs from your email history · Post-meeting follow-up drafts
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-8">
        {fetchError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load calendar events. Check your Google Calendar connection in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </div>
        )}

        {!fetchError && upcoming.length === 0 && recent.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-slate-600">No meetings in the next 7 days or past 24 hours.</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Upcoming
            </h2>
            <div className="space-y-4">
              {upcoming.map((event) => (
                <MeetingCard
                  key={event.id}
                  event={event}
                  calendarEmail={credential.email}
                  type="upcoming"
                />
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recent — generate follow-up
            </h2>
            <div className="space-y-4">
              {recent.map((event) => (
                <MeetingCard
                  key={event.id}
                  event={event}
                  calendarEmail={credential.email}
                  type="recent"
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/meetings/MeetingBriefView.tsx app/meetings/MeetingCard.tsx app/meetings/page.tsx
git commit -m "feat: add /meetings page with prep brief and follow-up generator"
```

---

## Task 7: Digest integration

**Files:**
- Create: `app/digest/MeetingsTodaySection.tsx`
- Modify: `app/digest/page.tsx`

- [ ] **Step 1: Create `app/digest/MeetingsTodaySection.tsx`**

```tsx
import Link from "next/link"
import type { CalendarEvent } from "@/lib/google"

export default function MeetingsTodaySection({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">
          {events.length} meeting{events.length === 1 ? "" : "s"} today
        </h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {events.map((event) => (
          <li key={event.id}>
            <Link href="/meetings" className="block px-6 py-4 hover:bg-slate-50">
              <p className="font-medium text-slate-900">{event.summary}</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {new Date(event.start).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {event.attendees.length > 0 &&
                  ` · ${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-xs font-medium text-indigo-600">View prep brief →</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Modify `app/digest/page.tsx` to fetch today's meetings and render the section**

Add these imports after the existing imports at the top of `app/digest/page.tsx`:

```typescript
import { getCalendarClient, listEvents } from "@/lib/google"
import MeetingsTodaySection from "@/app/digest/MeetingsTodaySection"
import type { CalendarEvent } from "@/lib/google"
```

Inside `DigestPage`, after the `const now = new Date()` line, add:

```typescript
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
```

Inside the `Promise.all([...])` array, add one more item at the end:

```typescript
    // Today's calendar meetings for prep brief cards
    prisma.googleCalendarCredential.findFirst({ where: { tenantId } }),
```

Update the destructuring to capture the new result:

```typescript
  const [
    pendingFollowUps,
    needsReply,
    pendingApprovals,
    expiringHolds,
    commandCenterConversations,
    calendarCredential,
  ] = await Promise.all([...])
```

After the `Promise.all`, add the calendar events fetch:

```typescript
  let todayMeetings: CalendarEvent[] = []
  if (calendarCredential) {
    try {
      const calendar = await getCalendarClient(tenantId, calendarCredential.email)
      todayMeetings = await listEvents(calendar, {
        timeMin: startOfToday,
        timeMax: endOfToday,
        maxResults: 5,
      })
    } catch {
      // Best-effort — digest renders without meetings if calendar fails
    }
  }
```

In the JSX return, find where `<DailyBriefSections>` is rendered and add `<MeetingsTodaySection>` directly before or after it:

```tsx
        {todayMeetings.length > 0 && (
          <MeetingsTodaySection events={todayMeetings} />
        )}
        <DailyBriefSections commandCenter={commandCenter} />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/digest/MeetingsTodaySection.tsx app/digest/page.tsx
git commit -m "feat: add meetings today section to digest"
```

---

## Task 8: Nav link + master plan update

**Files:**
- Modify: `app/inbox/page.tsx`
- Modify: `docs/MASTER_PRODUCT_PLAN.md`

- [ ] **Step 1: Add "Meetings" link to the desktop nav in `app/inbox/page.tsx`**

In the desktop nav block (around line 211), add after the Reports link and before the Audit link:

```tsx
              <Link
                href="/meetings"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Meetings
              </Link>
```

In the mobile nav strip (around line 263), add after the Reports link and before the Audit link:

```tsx
            <Link
              href="/meetings"
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Meetings
            </Link>
```

- [ ] **Step 2: Update `docs/MASTER_PRODUCT_PLAN.md`**

In the Feature Index table, change:

```
| 11 | Meeting Prep From Email History | `Planned` | Phase 2 | Depends on calendar events, relationship memory, and thread summaries. |
| 12 | Post-Meeting Follow-Up Generator | `Planned` | Phase 2 | Depends on calendar events, notes/transcripts, tasks. |
```

to:

```
| 11 | Meeting Prep From Email History | `Partial` | Phase 2 | On-demand brief from PersonMemory + email threads; `/meetings` page + digest card. No persistence of briefs. |
| 12 | Post-Meeting Follow-Up Generator | `Partial` | Phase 2 | Notes + prior threads → follow-up draft → ApprovalRequest. Falls back to inline copy if no prior conversation exists. |
```

In the Decision Log table, add a new row:

```
| 2026-06-11 | Ship meeting prep + follow-up as first Phase 2 slice. | Reuses existing calendar, PersonMemory, and ApprovalRequest infrastructure. No schema changes. On-demand generation (no persistence). Follow-up attaches to existing conversation or falls back to inline copy. |
```

In the "Immediate Next Slice Recommendation" section, update the suggested first Phase 2 slice to note that meeting prep is now `Partial` and suggest the next priority (e.g., lead scoring refinement or knowledge base replies).

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass. Note the test count; no regressions.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/inbox/page.tsx docs/MASTER_PRODUCT_PLAN.md
git commit -m "feat: add Meetings nav link and update master plan for Phase 2 slice"
```

---

## Self-Review Notes

- **Spec coverage check:** All spec requirements are covered — `/meetings` page (Task 6), digest integration (Task 7), nav (Task 8), prep API (Task 4), follow-up API (Task 5), both prompts (Task 1), provider wiring (Task 2), `timeMax` for past-event fetching (Task 3).
- **Draft collision:** `Draft.conversationId` is `@unique` — the follow-up upsert replaces any existing draft on that conversation. This matches the behavior of `draft/suggest` and is acceptable for the first slice.
- **Type consistency:** `MeetingPrepAttendee` and `MeetingFollowUpAttendee` are defined in Task 1 and imported by name in Tasks 4 and 5. `CalendarEvent` from `@/lib/google` is used consistently across Tasks 3, 6, and 7.
- **No placeholders:** All code is complete. No TBDs.
