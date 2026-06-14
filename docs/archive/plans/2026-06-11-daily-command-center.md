# Daily Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable "Magic Daily Command Center" slice so users see what actually matters today and can handle a thread from one obvious assistant panel.

**Architecture:** Add a pure `lib/agent/command-center.ts` analyzer that converts existing conversation data into daily briefing and relationship-context view models. Server pages fetch tenant-scoped Prisma data, call the analyzer, and render compact command-center UI without introducing new persistence tables.

**Tech Stack:** Next.js 14 app router, React server/client components, Prisma, TypeScript, Vitest, Tailwind utility classes.

---

## File Structure

- Create `lib/agent/command-center.ts`: Pure deterministic analysis for daily briefing, conversation state, priority, next action, safety, and relationship context.
- Create `tests/command-center.test.ts`: Unit tests for analyzer behavior.
- Create `app/inbox/CommandCenterPanel.tsx`: Compact first-viewport inbox briefing.
- Create `app/digest/DailyBriefSections.tsx`: Fuller digest briefing sections.
- Create `app/conversations/[id]/HandleThisPanel.tsx`: Client-side "Handle this" button and assistant context rendering.
- Modify `app/inbox/page.tsx`: Fetch enough data for command center and render panel above search.
- Modify `app/digest/page.tsx`: Reuse analyzer and render richer command center before existing sections.
- Modify `app/conversations/[id]/page.tsx`: Pass latest draft/job/approval/hold data into the assistant context panel.

## Task 1: Analyzer Tests

- [x] **Step 1: Write failing tests**

Create `tests/command-center.test.ts` with tests that import `buildDailyCommandCenter`, `analyzeConversationForCommandCenter`, and `buildRelationshipContext`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/command-center.test.ts`

Expected: FAIL because `lib/agent/command-center.ts` does not exist.

## Task 2: Analyzer Implementation

- [x] **Step 1: Implement minimal analyzer**

Create `lib/agent/command-center.ts` with:

- `CommandCenterState`
- `CommandCenterPriority`
- `CommandCenterConversation`
- `DailyCommandCenter`
- `RelationshipContext`
- `analyzeConversationForCommandCenter`
- `buildDailyCommandCenter`
- `buildRelationshipContext`

The analyzer should classify by status, label, draft metadata, latest message direction, pending approval, active hold, stale outbound messages, and sensitive keywords.

- [x] **Step 2: Run analyzer tests**

Run: `npm test -- tests/command-center.test.ts`

Expected: PASS.

## Task 3: Inbox Command Center UI

- [x] **Step 1: Create compact panel**

Create `app/inbox/CommandCenterPanel.tsx` that receives a `DailyCommandCenter` and renders:

- Main headline.
- Dropped-ball reassurance.
- Count chips for categories.
- Top action list linking to conversations.

- [x] **Step 2: Wire inbox page**

Modify `app/inbox/page.tsx` to fetch recent conversations with messages, draft, agent jobs, approvals, calendar holds, channel, and contact. Call `buildDailyCommandCenter` and render the panel above search.

## Task 4: Digest Command Center UI

- [x] **Step 1: Create digest sections**

Create `app/digest/DailyBriefSections.tsx` that renders action sections from `DailyCommandCenter`.

- [x] **Step 2: Wire digest page**

Modify `app/digest/page.tsx` to call the analyzer and render the new briefing before existing operational sections.

## Task 5: Conversation Handle-This Panel

- [x] **Step 1: Create client panel**

Create `app/conversations/[id]/HandleThisPanel.tsx`. It should render relationship context, next action, safety reason, and a "Handle this" button that posts to `/api/conversations/:id/draft/suggest` and refreshes the router.

- [x] **Step 2: Wire conversation page**

Modify `app/conversations/[id]/page.tsx` to fetch pending approvals and latest job, build assistant context, and render the panel above AI draft.

## Task 6: Verification

- [x] **Step 1: Run focused tests**

Run: `npm test -- tests/command-center.test.ts`

Expected: PASS.

- [x] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run lint/build**

Run: `npm run lint` and `npm run build`

Expected: PASS.

Browser smoke test note: the unauthenticated app shell renders at `http://localhost:3000/login` with no console errors. Authenticated `/inbox` visual QA was blocked because the local Postgres database was not running at `localhost:5432`, so the documented seed user could not be created.
