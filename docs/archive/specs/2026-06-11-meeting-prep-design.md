# Meeting Prep + Post-Meeting Follow-Up — Design Spec

**Date:** 2026-06-11  
**Phase:** Phase 2 — Business Revenue Inbox Agent  
**Features:** #11 Meeting Prep From Email History, #12 Post-Meeting Follow-Up Generator  
**Status:** Approved, ready for implementation

---

## Problem

FlowDesk already knows who you've emailed, what they asked, and what you promised. But that context disappears the moment you get on a call. Meeting prep bridges the gap: before a meeting, surface everything relevant from prior threads. After the meeting, auto-draft the follow-up email.

This is the clearest "chief of staff" moment in the product — almost no other AI email tool does this.

---

## Scope

### In this slice

- `/meetings` page listing upcoming Google Calendar events (next 7 days) and recent past events (last 24h)
- On-demand meeting prep brief per event: contact summary, prior topics, tone, talking points, open items, risk flags
- Post-meeting follow-up generator: user adds brief notes, AI drafts the follow-up email and queues it in Approvals
- "Meetings Today" section in the digest daily brief linking to `/meetings`
- "Meetings" nav link in the sidebar

### Out of scope for this slice

- Persisting generated prep briefs (live-computed each time, no new DB model)
- Outlook calendar support (Google Calendar only)
- Auto-triggered cron follow-ups (manual trigger only)
- Multi-attendee deep dives when attendees have no prior email history

---

## Architecture

### No schema changes

All state is live-computed or flows into the existing `ApprovalRequest` model. No new Prisma models required.

### Data flow — meeting prep

```
User clicks "Generate Prep Brief"
  → POST /api/meetings/prep { eventId, attendeeEmails, calendarEmail }
    → match attendeeEmails to Contact.email (case-insensitive, per tenant)
    → for each matched contact: load PersonMemory + last 5 conversations (up to 30 messages each)
    → build prompt with event title, attendee context, thread history
    → OpenAI structured output → MeetingPrepResult
    → write AuditLog (meeting_prep.generated)
    → return brief to client
  → MeetingCard renders brief inline
```

### Data flow — post-meeting follow-up

```
User fills notes textarea, clicks "Generate Follow-up Draft"
  → POST /api/meetings/follow-up { eventTitle, attendeeEmails, userNotes, calendarEmail }
    → match attendees to contacts (same as above)
    → load PersonMemory + recent thread context
    → build prompt with event title, user notes, relationship context
    → OpenAI generates follow-up email body (subject + body)
    → create ApprovalRequest with draft body, linked to first matched contact's conversation (or standalone)
    → write AuditLog (meeting_follow_up.draft_created)
    → return { approvalRequestId }
  → MeetingCard shows "Follow-up draft created → Review in Approvals" link
```

---

## New Files

### `lib/ai/prompts/meeting-prep.ts`

Structured output schema and prompt builder.

```typescript
export type MeetingPrepResult = {
  contactSummary: string        // who they are, relationship context, last contact date
  whatTheyAskedAbout: string[]  // topics and questions from prior email threads
  lastTone: string              // e.g. "warm and enthusiastic", "frustrated", "new lead, no prior relationship"
  talkingPoints: string[]       // suggested topics to raise or push for in this meeting
  openItems: string[]           // unkept promises or unanswered questions from threads
  riskFlags: string[]           // anything sensitive to handle carefully (empty array if none)
  model: string
}
```

Input:
```typescript
export type MeetingPrepPromptInput = {
  eventTitle: string
  eventStart: Date
  attendees: Array<{
    email: string
    name: string | null
    personMemory: {
      summary: string
      preferences: string | null
      openQuestions: string | null
      promisedActions: string | null
    } | null
    recentMessages: Array<{ direction: string; body: string; createdAt: Date }>
  }>
}
```

### `lib/ai/prompts/meeting-follow-up.ts`

Prompt builder for follow-up email generation.

```typescript
export type MeetingFollowUpPromptInput = {
  eventTitle: string
  eventStart: Date
  userNotes: string
  attendees: Array<{
    email: string
    name: string | null
    personMemory: { summary: string; preferences: string | null } | null
  }>
}

export type MeetingFollowUpResult = {
  subject: string
  body: string       // plain text email body
  model: string
}
```

### `lib/ai/provider.ts` additions

```typescript
export async function generateMeetingPrep(input: MeetingPrepPromptInput): Promise<MeetingPrepResult>
export async function generateMeetingFollowUp(input: MeetingFollowUpPromptInput): Promise<MeetingFollowUpResult>
```

### `app/api/meetings/prep/route.ts`

`POST` handler. Auth-gated (session required). Validates tenant ownership of the calendar credential. Loads contact + PersonMemory data. Calls `generateMeetingPrep`. Audits. Returns `{ brief: MeetingPrepResult }`.

Request body:
```typescript
{
  eventId: string
  eventTitle: string
  eventStart: string  // ISO string
  attendeeEmails: string[]
  calendarEmail: string
}
```

### `app/api/meetings/follow-up/route.ts`

`POST` handler. Auth-gated. Loads attendee context same as prep. Calls `generateMeetingFollowUp`. Looks for a `conversationId` to attach the approval to: uses the most recent conversation of the first matched contact. If no matched contact has a conversation, returns the generated email body directly (`{ body, subject }`) instead of creating an `ApprovalRequest` — the client renders it inline with a copy-to-clipboard fallback. Audits. Returns `{ approvalRequestId?: string, body?: string, subject?: string }`.

Request body:
```typescript
{
  eventTitle: string
  eventStart: string
  attendeeEmails: string[]
  calendarEmail: string
  userNotes: string
}
```

### `app/meetings/page.tsx`

Server component. Reads session, fetches Google Calendar events via `listEvents` with a 7-day window. Also fetches events from the past 24h (for follow-up). Passes events and `calendarEmail` to client.

If no Google Calendar credential exists for the tenant: renders a "Connect Google Calendar" prompt with a link to settings.

### `app/meetings/MeetingCard.tsx`

Client component. Renders one calendar event. State machine:

**Upcoming event (starts in future):**
1. Initial: event title, time, attendee list, "Generate Prep Brief" button
2. Loading: spinner
3. Brief ready: renders `MeetingBriefView` with all sections
4. Error: inline error message with retry

**Recent event (ended within last 24h):**
1. Initial: event title, time, "Add notes and generate follow-up" section — textarea + button
2. Loading: spinner
3. Done (approval created): "Follow-up draft created → Review in Approvals" link
4. Done (no prior conversation): generated email body shown inline with copy-to-clipboard button

### `app/meetings/MeetingBriefView.tsx`

Display-only component for a `MeetingPrepResult`. Renders:
- Contact summary + last tone badge
- "What they asked about" list
- Talking points list
- Open items list (only if non-empty)
- Risk flags list (only if non-empty)

---

## Digest Integration

`app/digest/DailyBriefSections.tsx` — add a `MeetingsTodaySection` that:
- Accepts a list of same-day calendar events (passed from `app/digest/page.tsx` which already has the pattern of fetching data server-side)
- Renders each event with title, time, attendee count, and a "Prep brief →" link to `/meetings`
- Shows a soft "No meetings today" state if the list is empty
- Only renders the section if Google Calendar is connected

`app/digest/page.tsx` — fetch same-day calendar events and pass to `DailyBriefSections`.

---

## Nav

`app/inbox/page.tsx` — add "Meetings" link to both the desktop sidebar nav and the mobile nav strip, between "Reports" and existing links. Uses a calendar icon (consistent with existing nav icon style).

---

## Contact Matching

```typescript
async function matchAttendeesToContacts(tenantId: string, emails: string[]) {
  return prisma.contact.findMany({
    where: {
      tenantId,
      email: { in: emails.map(e => e.toLowerCase()), mode: "insensitive" }
    },
    include: {
      personMemory: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        include: { messages: { orderBy: { createdAt: "asc" }, take: 30 } }
      }
    }
  })
}
```

Attendees with no matched contact are included in the prompt as "no prior email history" — the brief still generates, just with less context.

---

## Error Handling

- No Google Calendar credential: show connect prompt (not an error state)
- Attendee not in contacts: handled gracefully — "no prior history" in prompt
- Calendar API failure: surface inline error on the meetings page
- LLM call failure: inline error with retry button (same pattern as explain-thread)
- ApprovalRequest creation failure: return 502, surface inline error
- No matched conversation for follow-up: degrade gracefully to inline copy-paste flow (not an error)

---

## Audit Events

| Action | Payload |
|---|---|
| `meeting_prep.generated` | `{ eventTitle, attendeeCount, matchedContactCount, model }` |
| `meeting_follow_up.draft_created` | `{ eventTitle, approvalRequestId, attendeeCount, notesLength }` |

---

## Testing

- Unit test `matchAttendeesToContacts` for case-insensitive matching and missing attendees
- Unit test prompt builders for expected structure with/without PersonMemory
- Integration test `/api/meetings/prep` with a mock calendar credential and seeded contacts
- Integration test `/api/meetings/follow-up` verifying an `ApprovalRequest` row is created

---

## Master Plan Updates

- Feature #11 (Meeting Prep): `Planned` → `Partial` on first slice ship
- Feature #12 (Post-Meeting Follow-Up): `Planned` → `Partial` on first slice ship
