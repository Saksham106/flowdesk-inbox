# Daily Command Center Design

## Purpose

FlowDesk should open with a calm decision list instead of a raw unread count. The feature brief describes a broad roadmap: daily briefing, autopilot rules, handle-this automation, follow-up intelligence, relationship memory, dropped-ball states, lead capture, knowledge-base replies, voice matching, sensitive email detection, meeting prep, post-meeting follow-up, tasks, and scheduling.

This first implementation focuses on the most valuable slice that can be shipped safely on top of the current app:

- A daily command center on the inbox and digest pages.
- Deterministic conversation analysis for priority, state, brief text, next action, and sensitivity.
- A thread-level assistant context sidebar that explains what matters about a person and thread.
- A "Handle this" action that reuses the existing draft suggestion endpoint and makes the next step obvious.

## Existing Foundations

The app already has conversations, messages, contacts, drafts, approval requests, agent jobs, calendar holds, follow-up settings, autopilot settings, knowledge documents, and learned reply profiles. It also has an AI draft panel, follow-up batch logic, and a digest page. The first release should reuse these primitives instead of adding a new CRM, task database, or calendar orchestration layer.

## Scope For This Release

In scope:

- Categorize conversations into states aligned with the brief: needs reply, waiting on them, waiting on you, scheduled, done, risky / urgent, opportunity, and FYI only.
- Produce a daily briefing that highlights important replies, follow-ups, approvals, expiring calendar holds, opportunities, sensitive/problem threads, and safely ignored items.
- Show "You have 0 dropped balls" when no urgent actionable conversations exist.
- Add "Handle this" copy and behavior to the conversation assistant panel by triggering the existing draft suggestion flow.
- Add relationship memory-lite from current data: contact name, last conversation summary, open tasks, tone hints, promises/signals, money/lead clues, and relationship status.
- Add tests for the deterministic analysis layer.

Out of scope for this release:

- New database tables for tasks, CRM pipeline, person memory, or meeting notes.
- Autonomous sending beyond the existing autopilot infrastructure.
- External task/calendar/CRM sync.
- Website crawling for knowledge documents.
- LLM-generated daily summaries. The first release should be deterministic and stable; AI classification metadata and drafts are consumed when already present.

## Product Behavior

When the user opens `/inbox`, the first viewport shows a briefing:

- "Here are the N things that actually matter today."
- Counts for needs reply, waiting on someone else, approvals, meetings/prep, opportunities, potential problems, and safely ignored.
- Top action items with a short reason and next action.

The existing conversation list remains below the briefing so users can still scan their inbox.

`/digest` becomes the fuller version of the command center. It keeps current follow-up, approval, stale reply, and calendar hold sections, but adds a consolidated briefing and better states.

On a conversation page, the assistant sidebar shows:

- A "Handle this" button that calls the existing draft suggestion endpoint.
- What FlowDesk thinks is happening.
- Recommended next action.
- Why approval is needed if the thread is sensitive, risky, low-confidence, legal/finance/medical, angry, refund-related, or emotionally sensitive.
- Person context derived from the contact, thread, recent messages, draft metadata, labels, and calendar holds.

## Architecture

Create `lib/agent/command-center.ts` as a pure analysis module. It accepts loaded conversations, drafts, agent jobs, approval requests, and calendar holds, then returns typed view models for the inbox, digest, and conversation sidebar. The module should not call Prisma directly; pages own data fetching and pass plain objects to the analyzer.

This boundary keeps the logic unit-testable and avoids scattering inbox intelligence across React components. The pages can evolve independently while the analyzer remains stable.

## Data Flow

1. Server components fetch tenant-scoped data with Prisma.
2. The page passes recent conversation data into `buildDailyCommandCenter`.
3. The analyzer computes state, priority, reason, next action, safety, opportunity, and ignored counts.
4. `/inbox` renders a compact command center above search and the conversation list.
5. `/digest` renders the richer briefing.
6. Conversation detail fetches latest job, draft metadata, active hold, pending approval, and recent messages, then renders assistant context.
7. "Handle this" uses the existing `/api/conversations/:id/draft/suggest` route, preserving current approval safeguards.

## Error Handling

The command center is deterministic and should degrade gracefully:

- Missing messages produce "No messages yet" and low priority.
- Missing draft metadata falls back to labels, status, and keyword analysis.
- Unknown labels remain supported through a generic display.
- No business profile still disables actual draft generation through existing AI draft safeguards.

## Testing

Add unit tests for:

- Needs-reply, waiting-on-them, opportunity, risky, scheduled, done, and FYI state classification.
- Daily briefing counts and "0 dropped balls" behavior.
- Priority sorting for urgent/sensitive/actionable threads.
- Relationship context extraction from contact, labels, message text, and draft metadata.

Manual verification:

- `npm test -- tests/command-center.test.ts`
- `npm run lint`
- `npm run build`

## Roadmap After This Release

1. Persist extracted tasks and lead cards.
2. Add user-controlled category autopilot rules.
3. Add true relationship memory with person-level summaries.
4. Add automatic follow-up sequences for paid accounts.
5. Add meeting prep and post-meeting follow-up from calendar events.
6. Add external task/CRM sync.
