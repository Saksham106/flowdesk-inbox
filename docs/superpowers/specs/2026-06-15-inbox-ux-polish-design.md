# FlowDesk Inbox — UI/UX Polish (Session 2)

**Date:** 2026-06-15  
**Status:** Approved

## Scope

Seven improvements to the inbox, email reading, and conversation view. Split into quick wins (no design question) and design decisions (visual mockups reviewed and approved).

---

## Quick Wins

### 1. Wide-screen Home layout

**File:** `app/components/HomeCommandCenter.tsx`  
**Change:** Add `mx-auto` to the inner container div (`px-5 py-5 max-w-5xl`).  
Content centers on wide monitors instead of pinning to the left edge.

### 2. Remove duplicate Sync button

**Files:** `app/components/HomeHeader.tsx`, `app/components/AppListColumn.tsx`  
**Problem:** Both render `<GmailSyncControl compact />`. On desktop the home view shows both panels simultaneously.  
**Change:** Remove `<GmailSyncControl>` from `HomeHeader`. The inbox list column header (`AppListColumn`) is the canonical sync-status location.

### 6. Email reading area padding

**File:** `app/conversations/[id]/page.tsx`  
**Change:** Tighten the desktop message thread scroll area: `px-3 py-4` → `px-2 py-3`. Tighten article card inner padding: `px-4 py-3` → `px-3 py-2.5`. More reading space, less chrome overhead.

---

## Design Decisions

### 3. Hover actions on inbox list rows

**Approach:** Icon strip revealed on hover, no dropdown menu.

**Architecture:**  
- `AppListColumn` is a server component — rows are plain `<Link>` elements.  
- Extract a new client component `InboxRow` that wraps the row markup and manages hover state with `useState`.  
- `AppListColumn` passes row data as props; `InboxRow` renders the link content + the hover action strip.

**Actions (3 icons, always same order):**
| Icon | Label | Action |
|------|-------|--------|
| ● (dot) | Mark unread / Mark read | `PATCH /api/conversations/:id/read` with `{ read: false/true }` |
| ✓ (check) | Close / Reopen | `PATCH /api/conversations/:id/status` (existing endpoint) |
| ••• | More (no-op for now) | Reserved — future: tag, snooze |

**UX behavior:**
- Icons slide in on `group-hover` (Tailwind `group` pattern on the row `<div>`).
- Optimistic state update: row re-renders immediately, `router.refresh()` syncs server state.
- Click on icon must `e.stopPropagation()` + `e.preventDefault()` to avoid navigating to the thread.
- Closed rows show ↺ (reopen) instead of ✓.

**Files to create/modify:**
- `app/components/InboxRow.tsx` (new client component)
- `app/components/AppListColumn.tsx` (import and use `InboxRow`, keep server-side data fetching)

### 4–5. Reply composer — collapsed state + email fields

**Approach:** Compact collapsed bar by default; expands in-place on click.

**Collapsed state:**
- Single row: avatar chip + placeholder text "Reply to {name}…" + "Reply" button.
- Rendered by `ReplyComposer` when `!isExpanded`.

**Expanded state (new layout):**
- **To field:** Pre-filled with sender address (from thread). Read-only for replies. Shows sender name if available.
- **CC / BCC:** Collapsed — shown as small buttons next to To field. Clicking appends a text input row below.
- **Subject:** "Re: {original subject}" — read-only (displayed, not editable for replies).
- **Body textarea:** Same as current, `rows={5}` when expanded.
- **Toolbar (bottom of composer):**
  - Left: "Draft with AI" button (existing logic, shown only when `canAI`)
  - Right: "Discard" (collapses back) + "Send" button (existing logic)
- **AI instruction:** "+ Add instruction for AI" link below toolbar (same as current collapsible)

**State added to `ReplyComposer`:**
- `isExpanded: boolean` — false by default, true when draft already exists or user clicks
- `ccOpen: boolean` — toggles CC field
- `bccOpen: boolean` — toggles BCC field
- `cc: string` / `bcc: string` — values passed into the send API

**Backend note:** The current `send` API endpoint accepts `{ text }`. CC/BCC fields require backend support to pass through to Gmail. If `POST /api/conversations/:id/send` doesn't accept `cc`/`bcc`, the fields are rendered in the UI but a `// TODO: wire cc/bcc into send API` comment is left — no fake behavior.

**Auto-expand:** If `initialDraft` is non-null (AI draft exists), start expanded.

**Files:**
- `app/conversations/[id]/ReplyComposer.tsx` (expand existing component)

### 7. Simplify right rail for low-value emails

**Logic:** When `isAutoEmailConversation === true`, render only:
1. `contactCard`
2. `assistantCard` (the "No reply needed" / "Quiet" card)

Hide for auto-email conversations:
- `summaryCard`
- `<ExplainThreadPanel>`
- `<WorkItemsPanel>` (via `CollapsibleCard`)
- `personMemory` / relationship card

**Business panels** (`SupportPanel`, `SalesPanel`, `CalendarHoldPanel`) are already gated on their own conditions (`isSupport`, `isSalesLead`, etc.) — those are unaffected.

**Why skip ExplainThread and WorkItems for FYI emails:**  
These panels trigger agent jobs on load. Skipping them for automated/newsletter/quiet emails saves unnecessary backend cycles and keeps the right rail minimal.

**Files:**
- `app/conversations/[id]/page.tsx` (wrap `extraCards` in `!isAutoEmailConversation` guard)

---

## Implementation Order

1. **Task 7** — right rail conditional (page.tsx, ~20 min, minimal risk)
2. **Tasks 1 + 2 + 6** — quick wins (HomeCommandCenter, HomeHeader, page.tsx, ~10 min)
3. **Task 3** — hover actions (new InboxRow client component, ~45 min)
4. **Tasks 4–5** — reply composer redesign (~60 min)

---

## Constraints (carried from session brief)

- No fake data, no fake actions.
- No frontend-only state masking backend bugs.
- Design: premium, calm, consistent.
- If backend CC/BCC support is missing, render fields but leave a clear TODO — do not fake send behavior.
- Use existing backend capabilities (`/api/conversations/:id/read`, `/api/conversations/:id/status`, `/api/conversations/:id/draft/suggest`, `/api/conversations/:id/send`).
