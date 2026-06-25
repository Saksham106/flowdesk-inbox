# Dashboard UX Polish — Design Spec
**Date:** 2026-06-25  
**Status:** Approved

---

## Problem

The dashboard exposes too much internal machinery to users:
- "Review all" in Quietly Handled routes to `/inbox?attention=fyi_done` — misses items marked done via the new workflow-status system (`status=closed`), effectively broken
- Bills & Deadlines dismiss for conversation items calls the old `/attention` endpoint with `attentionCategory: "fyi_done"` — does not persist correctly under the new model
- Read Later has two indistinguishable icon buttons hidden on hover with no text labels; the aria-labels reference internal terms ("FYI / Done", "Quiet")
- Handle First cards have no Snooze or Waiting On action — forcing users to open the full conversation view for common triage actions
- Agent Activity only shows "Sorted N emails into categories" — generic and not tied to visible outcomes
- Microcopy uses internal terms ("FYI / Done", "Not needed", "classification updated")
- No undo when an item is accidentally marked done

---

## Goal

Make the dashboard feel like an AI assistant that quietly handles email and surfaces exactly what needs attention. Every card should have a clear next action. Dismissals should persist. Language should be human and outcome-focused.

---

## Approach

**Unified action pattern (Approach B).** Standardize all dashboard cards to the same hover-reveal action row with clearly labeled text buttons. Fix all broken endpoints. Add Snooze with preset menu on Handle First. Add undo toast on mark-done. Fix Quietly Handled review link. Improve Agent Activity with breakdown data. No new API routes. No new pages.

---

## Section-by-Section Design

### 1. Handle First

**Current state:** Draft Reply + Mark Done buttons. No snooze, no Waiting On.

**New action rows by item type:**

| Item type | Primary (blue) | Secondary |
|---|---|---|
| `needsReply` (no draft) | Draft Reply | Waiting On · Snooze · Done |
| `approvalReason` (draft ready) | Review Draft | Done · Snooze |
| `needsAction` (OTP / security) | Open link / Copy code | Handled · Snooze |

**Snooze UX:** Clicking "Snooze" opens a small inline popover (absolute-positioned `<div>`) with three preset options:
- "Tonight (8 pm)" → snoozeUntil = today at 20:00 local time
- "Tomorrow morning" → snoozeUntil = tomorrow at 09:00 local time
- "Next week" → snoozeUntil = next Monday at 09:00 local time

Calls `POST /api/conversations/[id]/snooze` with `{ snoozeUntil: ISO string }`. The ISO string is computed client-side: "Tonight (8 pm)" = today's date with hours set to 20:00:00 in the user's local timezone, converted to UTC ISO string. "Tomorrow morning" = tomorrow at 09:00:00 local. "Next week" = next Monday at 09:00:00 local. Card disappears immediately (optimistic). Popover closes on selection or outside click.

**Waiting On:** Calls `PATCH /api/conversations/[id]/workflow-status` with `{ workflowStatus: "waiting_on" }`. Card removed from Handle First immediately.

**Done + Undo:** Calls `/workflow-status` with `done`. Instead of immediately removing the card, the card enters an "undoable" state showing "Marked as done · Undo" for 5 seconds. Clicking Undo calls `/workflow-status` with `needs_reply` and restores the card. After 5 seconds with no undo, the card removes itself. This is managed entirely within each card's local state — no cross-component or lifted state required (HomeCommandCenter is a server component and cannot hold shared callback state).

**Microcopy changes:**
- "Mark Done" → "Done"
- NeedsAction "Not needed" → "Handled"

---

### 2. Bills & Deadlines

**Current state:** Single hover-only checkmark icon. Conversation dismiss calls old `/attention` endpoint.

**Bug fix:** Conversation items: change dismiss from `PATCH /attention` with `{ attentionCategory: "fyi_done" }` to `PATCH /workflow-status` with `{ workflowStatus: "done" }`.

**New action area:** Two labeled buttons, visible on hover (`group-hover:opacity-100`):
- **Done** — closes the item (task: `PATCH /tasks/[id]/status { status: "closed" }` / conversation: `/workflow-status { done }`)
- **Not relevant** — same call, distinct label for billing alerts the user wants to dismiss

Both buttons persist on focus (accessible via keyboard). The row link ("Open") remains the default click target.

---

### 3. Read Later

**Current state:** Two identical icon buttons hidden on hover. Aria-labels use "FYI / Done" and "Quiet" (internal terms). Both buttons now call the same endpoint.

**New action area:** Two labeled text buttons on hover:
- **Done** — calls `/workflow-status` with `done`. Optimistic remove. Shows undo toast.
- **Not interested** — calls `/workflow-status` with `done`. Same endpoint, different label — communicates "remove this permanently" for newsletters/promos.

**"+N more" link:** Route to `/inbox?attention=read_later` — the inbox already supports this attention filter and shows all read-later items.

**Microcopy:** Remove all internal-term aria-labels. Both buttons get clear text.

---

### 4. Quietly Handled

**Current state:** "Review all →" links to `/inbox?attention=fyi_done` — only catches AI-classified items with `attentionCategory=fyi_done`. Items marked done via `/workflow-status` have `status=closed` instead, so this route misses them.

**Fix:** Change the link to `/inbox?status=closed`. The inbox page already supports `?status=closed` via the `STATUS_FILTERS` constant and the Prisma WHERE clause. This shows the full set of done/closed conversations. The existing `WorkflowStatusSelect` in each conversation's detail view lets users move items back to Needs Reply or Read Later.

**Microcopy:** "emails quietly handled" → "emails sorted quietly".

---

### 5. Agent Activity

**Current state:** Generic "Sorted N emails into categories". Only uses `classifiedLast24h` and `draftedLast24h`.

**New:** Pass `quietlyHandledBreakdown` prop (already available in `HomeCommandCenter`) into `AgentActivitySection`. Generate specific lines:

```
✦  Sorted {classifiedLast24h} emails today                       (if > 0)
✦  Moved {newsletter+notification+marketing} newsletters & updates to Quiet   (if > 0)
✉  Drafted {draftedLast24h} repl{y/ies} for your review          (if > 0)
🧠 Learned from your recent feedback                             (if learnedRecentlyUpdated)
```

Empty state: "All quiet — no activity in the last 24 hours."

Remove the "Found N items needing action" line (redundant — NeedsActionSection already shows this above).

---

### 6. Undo Toast

A new `UndoToast` client component rendered once inside `HomeCommandCenter`. State is lifted: each card that supports undo calls an `onUndo(label, undoFn)` callback passed down as a prop. The toast shows for 5 seconds then auto-dismisses. Clicking "Undo" invokes `undoFn()` and hides the toast.

Only one undo toast is active at a time (the most recent action wins).

**Affected cards:** HandleFirstCard (Done), ReadLaterCard (Done / Not interested). Each card manages its own undo timeout via `useEffect` + `clearTimeout` cleanup.

---

### 7. Microcopy Reference

| Location | Before | After |
|---|---|---|
| Handle First "Mark Done" button | "Mark Done" | "Done" |
| NeedsAction dismiss | "Not needed" | "Handled" |
| ReadLater done button (aria) | "Mark as FYI / Done" | "Done" |
| ReadLater quiet button (aria) | "Mark as Quiet" | "Not interested" |
| ReadLater done button (visible) | icon only | "Done" |
| ReadLater not-interested button (visible) | icon only | "Not interested" |
| Bills dismiss aria-label | "Mark done" | "Done" |
| Bills new button | — | "Not relevant" |
| Quietly Handled banner | "emails quietly handled" | "emails sorted quietly" |
| Agent Activity empty state | "No agent activity yet." | "All quiet — no activity in the last 24 hours." |

---

## Components Changed

### Modified
- `app/components/HandleFirstSection.tsx` — add Snooze popover, Waiting On button, rename Done, undo callback
- `app/components/NeedsActionSection.tsx` — rename "Not needed" → "Handled"
- `app/components/BillsDeadlinesList.tsx` — fix conversation dismiss endpoint, add "Not relevant" button, make buttons visible on hover
- `app/components/ReadLaterSection.tsx` — replace icon buttons with labeled text buttons, undo callback
- `app/components/QuietlyHandledBanner.tsx` — fix "Review all" link, update microcopy
- `app/components/AgentActivitySection.tsx` — add `quietlyHandledBreakdown` prop, specific activity lines
- `app/components/HomeCommandCenter.tsx` — pass `quietlyHandledBreakdown` to AgentActivitySection

### New
- No new files required — undo state is managed inline within each card component

---

## API Endpoints Used (no new routes)

| Action | Endpoint |
|---|---|
| Mark done | `PATCH /api/conversations/[id]/workflow-status { workflowStatus: "done" }` |
| Waiting On | `PATCH /api/conversations/[id]/workflow-status { workflowStatus: "waiting_on" }` |
| Undo done | `PATCH /api/conversations/[id]/workflow-status { workflowStatus: "needs_reply" }` |
| Snooze | `POST /api/conversations/[id]/snooze { snoozeUntil: ISO string }` |
| Close task | `PATCH /api/tasks/[id]/status { status: "closed" }` |

---

## What Is NOT Changed

- Overall dashboard layout (60/40 grid, section order)
- WaitingOnSection — already clean
- HandleFirstSection card layout/design
- Any server-side data fetching or command center scoring logic
- Snooze unsnooze / reminder logic
- Inbox conversation list

---

## Acceptance Criteria

- Every Handle First card has Done, Snooze, and (where applicable) Draft Reply / Review Draft / Waiting On
- Snooze shows three presets and calls the snooze API
- Waiting On removes card from Handle First immediately
- Undo toast appears for 5 seconds after mark-done on Handle First and Read Later cards
- Bills & Deadlines dismiss persists after refresh (calls `/workflow-status` not `/attention`)
- Bills items have "Done" and "Not relevant" labeled buttons
- Read Later cards have "Done" and "Not interested" labeled text buttons on hover
- Quietly Handled "Review all" routes to `/inbox?status=closed` (shows actual done items)
- Agent Activity shows breakdown-level lines (newsletters moved, replies drafted)
- No internal terms visible in any dashboard card UI
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass
