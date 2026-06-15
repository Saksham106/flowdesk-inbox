# Home Command Center Redesign

**Date:** 2026-06-14  
**Status:** Approved — ready for implementation

---

## Goal

Redesign the FlowDesk Home page from a mostly-empty dashboard into a focused AI agent command center. Users should immediately see what needs their attention, what the AI handled, and what they can ignore — all on one screen without scrolling past the fold on typical desktop viewports.

---

## Layout: Asymmetric 60/40 Split (Option C)

```
┌─────────────────────────────────────────────────────────────────┐
│  Rail │  List Panel (unchanged)  │  HOME MAIN                   │
│       │                          │  ┌─────────────────────────┐ │
│       │                          │  │  Header (greeting/sync) │ │
│       │                          │  │  Stats row (5 pills)    │ │
│       │                          │  ├──────────────┬──────────┤ │
│       │                          │  │ Left 60%     │ Right 40%│ │
│       │                          │  │              │          │ │
│       │                          │  │ Handle First │ Read     │ │
│       │                          │  │              │ Later    │ │
│       │                          │  │ Needs Action │ Waiting  │ │
│       │                          │  │              │ On       │ │
│       │                          │  │              │ Agent    │ │
│       │                          │  │              │ Activity │ │
│       │                          │  ├──────────────┴──────────┤ │
│       │                          │  │ Quietly Handled (banner)│ │
│       │                          │  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Responsive behavior
- **≥1024px (lg):** Full 60/40 split with sidebar.
- **768px–1023px (md):** Single column; right-column sections stack below left-column sections.
- **<768px (sm/mobile):** Single column stacked order: stats → Handle First → Needs Action → Read Later → Waiting On → Agent Activity → Quietly Handled banner.

---

## Sections

### 1. Header
**Full width, compact.**

- Greeting: "Good morning/afternoon/evening, [first name]" + date string (derived client-side from server-passed `Date`).
- Sync row: "Synced X ago" timestamp + `↻ Sync` button (wraps `GmailSyncControl` in inline mode, already exists).
- No dark gradient hero. No large headline.

### 2. Stat Pills
**Full width, 5 pills.**

| Pill | Count source | Color accent |
|---|---|---|
| Needs Reply | `commandCenter.counts.needsReply` | Red `#dc2626` |
| Needs Action | `commandCenter.counts.needsAction` *(new)* | Amber `#d97706` |
| Waiting On | `commandCenter.counts.waitingOnThem` | Blue `#2563eb` |
| Read Later | `commandCenter.counts.readLater` *(new)* | Neutral |
| Quietly Handled | `commandCenter.counts.safelyIgnored` | Dimmed gray |

Pills are display-only; they do not filter the page.

### 3. Handle First (Left 60%)
**Primary action cards. Show top 5 by priority.**

Source: `commandCenter.topActions` (already sorted by priority score, filtered to exclude `safelyIgnored`).

Card fields:
- **Sender name** (bold)
- **Subject** (truncated to one line)
- **AI reason** (10px italic, from `item.reason`)
- **Timestamp** (relative)
- **Priority tint:** subtle left border + light background tint
  - `urgent`: 2px `#ef4444` left border, `#fff5f5` tint
  - `high`: 2px `#f59e0b` left border, `#fffdf0` tint
  - `medium`/`low`: no tint, standard white card

Action buttons per card (only show buttons for real capabilities):

| Button | Condition to show | Action |
|---|---|---|
| **Draft Reply** | `item.needsReply === true` | POST `/api/conversations/[id]/draft/suggest` → navigate to conversation |
| **Review Draft** | `item.approvalReason !== null` | Navigate to `/conversations/[id]` |
| **Mark Done** | always | PATCH `/api/conversations/[id]/status` `{ status: "closed" }` → optimistic remove from list |
| **Open** | always | Navigate to `/conversations/[id]` |

"Draft Reply" is a client action: POST the suggest route, then redirect to the conversation view. Show a brief loading state on the button while the request is in-flight.

Empty state: single compact card — "All caught up · Nothing needs attention right now." (no large blank space).

### 4. Needs Action (Left 60%, below Handle First)
**Amber strip cards for OTP, verification links, security alerts, account setup.**

Source: `commandCenter.sections.needsAction` *(new field — see Data Model below)*.

These are items where `attentionCategory === "needs_action"`: email contains a verification link, OTP, password reset, or similar time-sensitive action. They are currently mixed into `sections.approvals`; this redesign separates them.

Card fields: sender, subject (truncated), reason (italic, e.g. "Verification link detected"). Single "Open →" button (navigation only — no fake action).

Hide section entirely if empty (no "nothing here" card; the page is already calmer without it).

### 5. Read Later (Right 40%)
**Cards for newsletters and content the user may actually care about.**

Source: `commandCenter.sections.readLater` *(new field)*.

These are items where `attentionCategory === "read_later"`. Currently they fall into `topActions` with low priority and no dedicated section. This redesign gives them a dedicated right-column slot.

Card fields: sender, subject (truncated), tag badge (`Newsletter`, `Update`, etc. from `emailType`), relative timestamp.

Single "Open" navigation action. No dismiss/mark-read button in v1.

Show "See all N →" link if more than 3 items.

Empty state: single compact line — "Nothing queued to read." (inline, not a card).

### 6. Waiting On (Right 40%)
**Items where the user sent a message and is waiting for a reply.**

Source: `commandCenter.sections.waitingOnThem`.

Card fields: contact name, context ("Sent X · N days ago" from `item.reason`), **Nudge →** button.

**Nudge** navigates to `/conversations/[id]`. The draft suggest route (`/api/conversations/[id]/draft/suggest`) is available from within the conversation view; no automatic send occurs. v1 Nudge is navigation-only.

Empty state: single compact line — "Not waiting on anyone." (inline).

### 7. Agent Activity (Right 40%)
**A compact log of what the AI did, derived from real data. No fabricated events.**

Source: new server-side query (see Data Model below). Four possible rows, each only shown if true:

| Event | Source |
|---|---|
| "Sorted **N** emails into categories" | Count of `ConversationState` records updated in the last 24h for this tenant |
| "Found **N** item(s) needing action" | `commandCenter.counts.needsAction` |
| "Drafted **N** reply/replies for your review" | Count of `AgentJob` records with `status = "completed"` and `trigger` matching draft jobs in last 24h |
| "Updated preferences from your feedback" | `LearnedReplyProfile.updatedAt` is within the last 7 days |

Each row has a relative timestamp (or "today"/"this week"). If there are zero events (brand-new account), show: "No agent activity yet." (compact, single line).

Pulsing green dot in header indicates agent is active (always shown).

### 8. Quietly Handled (Full-width bottom banner)
**A single compact summary card. Not a list.**

Source: `commandCenter.counts.safelyIgnored` for total, plus new `agentSummary.quietlyHandledBreakdown` for category pills (see Data Model).

Layout: large dimmed number | label + category pills | "Review all →" button.

- "Review all →" navigates to `/inbox?status=all` or similar — no new route needed.
- Category pills: dynamically built from breakdown query. Only show pill types that have count > 0.
- If total is 0, hide the banner entirely.

---

## Data Model Changes

### `lib/agent/command-center.ts`

**Add to `CommandCenterConversation`:**
```ts
needsAction: boolean   // attentionCategory === "needs_action"
```

**Add to `DailyCommandCenter.counts`:**
```ts
needsAction: number
readLater: number
```

**Add to `DailyCommandCenter.sections`:**
```ts
needsAction: CommandCenterConversation[]
readLater: CommandCenterConversation[]
```

**Logic:** In `analyzeConversationForCommandCenter`, set `needsAction = attentionCategory === "needs_action"`. In `buildDailyCommandCenter`, populate `sections.needsAction` and `sections.readLater` from `attentionCategory`. Exclude `needsAction` items from `sections.approvals` to avoid double-counting.

### `app/inbox/page.tsx` — new query

Add a new server-side query for agent activity and breakdown data, executed only on `isHomeView`:

```ts
const agentSummary = {
  classifiedLast24h: number,         // ConversationState updated in last 24h
  draftedLast24h: number,            // AgentJob completed in last 24h with relevant trigger
  learnedRecentlyUpdated: boolean,   // LearnedReplyProfile updated in last 7d
  quietlyHandledBreakdown: {
    newsletter: number,
    notification: number,
    marketing: number,
    other: number,
  }
}
```

The breakdown comes from querying `ConversationState` records where `metadataJson->emailType` is one of the known types, filtered to the safelyIgnored set.

### `app/inbox/page.tsx` — prop additions

Pass to `HomeCommandCenter`:
- `agentSummary` (new)
- `gmailSyncChannels` already passed — confirm the sync button uses it

### `HomeCommandCenter` props update
```ts
interface Props {
  commandCenter: DailyCommandCenter    // sections.waitingOnThem drives "Waiting On"
  revenueAtRisk: RevenueAtRiskItem[]
  agentSummary: AgentSummary           // new
  accountType: string | null
  date: Date
  gmailChannels: GmailSyncChannel[]    // new — for inline sync button
}
```

**Props removed:** `ignoredItems` (replaced by banner count/breakdown) and `followUps` (the old scheduled agent-job queue). "Waiting On" now reads `commandCenter.sections.waitingOnThem` directly — conversations where we sent the last message and are awaiting a reply.

---

## Component Architecture

```
HomeCommandCenter.tsx        (server component wrapper, layout only)
  ├── HomeHeader.tsx          (greeting + sync button — "use client" for GmailSyncControl)
  ├── HomeStats.tsx           (5 stat pills — pure display)
  ├── HandleFirstSection.tsx  (card list — "use client" for Draft Reply + Mark Done)
  ├── NeedsActionSection.tsx  (amber strip cards — navigation links only)
  ├── ReadLaterSection.tsx    (right column — navigation links only)
  ├── WaitingOnSection.tsx    (right column — navigation links only)
  ├── AgentActivitySection.tsx (right column — pure display)
  └── QuietlyHandledBanner.tsx (full-width bottom — pure display + link)
```

Sub-components kept small and focused. `HandleFirstSection` is the only one that needs client-side state (button loading states for Draft Reply / Mark Done).

---

## Action Button Implementation

### Draft Reply
```
onClick:
  1. Set button to loading state ("Generating…")
  2. POST /api/conversations/[id]/draft/suggest
  3. On success: router.push(`/conversations/${id}`)
  4. On error: show inline error, restore button
```

### Mark Done
```
onClick:
  1. Optimistically remove card from list (useState)
  2. PATCH /api/conversations/[id]/status { status: "closed" }
  3. On error: restore card, show error
```

### Open
```
Link href="/conversations/[id]"
```

### Nudge
```
Link href="/conversations/[id]"
(draft generation available from within conversation view)
```

---

## Empty States

| Section | Empty state treatment |
|---|---|
| Handle First | Single compact card: "All caught up · Nothing needs attention right now." |
| Needs Action | Section hidden entirely |
| Read Later | Inline text: "Nothing queued to read." (no card) |
| Waiting On | Inline text: "Not waiting on anyone." (no card) |
| Agent Activity | Single line: "No agent activity yet." |
| Quietly Handled | Banner hidden entirely (count is 0) |

The page must not look broken with zero data — verified in QA.

---

## Visual Style

- **No heavy hero.** No dark gradient. No large headline.
- **Priority tinting:** subtle left border (2px) + very light background tint (`/5` opacity). Not warning-box style.
- **Type scale:** Section labels 10px uppercase. Card names 12px bold. Reasons 10px italic. Stats 17px bold.
- **Spacing:** 16px padding, 14px section gaps, 7px card gaps. Dense but not cramped.
- **Colors:** Only 3 accent colors (red, amber, blue) used sparingly for numbers in stat pills and left borders. Everything else is neutral slate.
- **Agent Activity:** Uses a 7px pulsing green dot to signal "live". Row text is muted (`#475569`), bold for numbers only.

---

## Files Changed

| File | Change |
|---|---|
| `lib/agent/command-center.ts` | Add `needsAction` field, `sections.needsAction`, `sections.readLater`, `counts.needsAction`, `counts.readLater` |
| `app/inbox/page.tsx` | Add `agentSummary` query, pass new props, remove `ignoredItems` prop |
| `app/components/HomeCommandCenter.tsx` | Full redesign to Option C layout |
| `app/components/HomeHeader.tsx` | New — compact header with inline sync |
| `app/components/HomeStats.tsx` | New — 5 stat pills |
| `app/components/HandleFirstSection.tsx` | New — client component with Draft Reply + Mark Done |
| `app/components/NeedsActionSection.tsx` | New — amber strip cards |
| `app/components/ReadLaterSection.tsx` | New — right-column read later cards |
| `app/components/WaitingOnSection.tsx` | New — right-column waiting cards |
| `app/components/AgentActivitySection.tsx` | New — right-column activity log |
| `app/components/QuietlyHandledBanner.tsx` | New — full-width bottom banner |

---

## QA Checklist

- [ ] Page renders without errors when there are 0 urgent emails
- [ ] Page renders without errors when there are 0 read-later emails
- [ ] Page renders without errors when quietly handled count is 0 (banner hidden)
- [ ] Handle First cards show correct priority tint (subtle left border, not heavy box)
- [ ] "Draft Reply" triggers POST to suggest route, shows loading state, navigates to conversation
- [ ] "Mark Done" closes conversation, removes card optimistically, handles error gracefully
- [ ] "Open" navigates to conversation view
- [ ] "Nudge" navigates to conversation view
- [ ] Sync button works (uses existing GmailSyncControl)
- [ ] Stat pills show correct counts
- [ ] Agent Activity shows only real events (zero fabricated rows)
- [ ] Quietly Handled breakdown pills are accurate (match safelyIgnored count)
- [ ] Layout is 60/40 on ≥1024px
- [ ] Layout stacks to single column on <768px
- [ ] No inbox list duplication on the Home page
- [ ] Existing conversation view and Gmail rendering unaffected
- [ ] TypeScript compiles cleanly (no `any` escapes for new fields)

---

## Backend Fields That Would Improve the Page Later

- **Snooze/remind:** A `snoozedUntil: DateTime` field on `Conversation` + a PATCH route would unlock the "Remind Later" button.
- **Nudge draft pre-population:** A `?intent=followup` query param handled by the conversation page could auto-trigger draft suggest on load.
- **Read Later mark-as-read:** A PATCH to `ConversationState.attentionCategory` would let users clear individual Read Later items from the home view.
- **Agent Activity richer log:** A dedicated `AgentEvent` table (type, message, conversationId, timestamp) would make this section more granular than counting job records.
- **Category breakdown persistence:** Storing the emailType breakdown in a daily summary record would be faster than aggregating from JSON metadata at page load.
