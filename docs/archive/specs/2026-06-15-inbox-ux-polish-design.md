# FlowDesk Inbox UX Polish — Design Spec
**Date:** 2026-06-15  
**Status:** Approved

---

## Overview

Six focused UX fixes for the FlowDesk inbox. No full redesigns; no new pages. All changes are constrained to the files listed. Gmail sync, classification behavior, and schema columns are untouched.

---

## Issue 1: Compact Reply Composer

### Problem
`ReplyComposer.tsx` renders a textarea with `rows={hasDraftText ? 6 : 4}` — always at least 4 rows tall even when the user hasn't started composing. This pushes email content out of view.

### Design
Expand-on-focus behavior:

- **Collapsed (default):** `rows=2`, no focus, no text content
- **Expanded:** `rows=5`, triggered by focus OR when `text.trim() !== ""`
- **Pre-loaded draft:** always start expanded (text is non-empty)
- On blur, if `text.trim() === ""`, collapse back to 2 rows

**State change:** Add `isFocused: boolean` to component state. The textarea's `rows` value becomes:
```
isFocused || hasDraftText ? 5 : 2
```

**Buttons stay always visible.** "Draft with AI" and "Send" never hide — they remain anchored below the textarea regardless of expanded/collapsed state. The instruction row and template picker continue to appear only when relevant.

**Files:** `app/conversations/[id]/ReplyComposer.tsx`

---

## Issue 2: Inbox Scroll Position Preservation

### Problem
`AppListColumn` is a Server Component. Navigating inbox → conversation re-renders it server-side, resetting the `overflow-y-auto` scroll position to the top.

### Design
Extract the scrollable list container into a thin `"use client"` component: `InboxScrollContainer`.

**Behavior:**
- On mount, reads scroll position from `sessionStorage` using key `flowdesk.inbox.scroll.${statusKey}` where `statusKey` encodes the current filter (status, q, sales flags)
- On scroll, debounce-saves (200ms) position to the same key
- `sessionStorage` is tab-scoped; clears on session end (intentional)
- The server component (`AppListColumn`) remains server-side; only the scroll div is a client island

**Key generation:** `status ?? "all"` + `q ?? ""` + `sales ? "s" : ""` joined with `_`. This ensures scroll resets when the filter changes (expected) but not when opening/closing conversations within the same filter (fixed).

**Files:**
- New: `app/components/InboxScrollContainer.tsx`
- Modified: `app/components/AppListColumn.tsx` (wrap the `flex-1 overflow-y-auto` div)

---

## Issue 3: Read/Unread Visual State

### Problem
Once a conversation is read (`readAt` is set), it looks nearly identical to a truly-done conversation. No visual distinction between "read but still needs reply" and "closed/FYI". There is also no dim treatment for read-but-inactive states.

### Design
Three-tier visual system based on `readAt` and conversation status:

| State | Name font | Row background | Dot color |
|---|---|---|---|
| **Unread** (`!readAt && !fyi`) | `font-bold text-slate-900` | hover: `bg-blue-50/60` | `bg-blue-500` (existing) |
| **Read, action needed** (`readAt && status=needs_reply`) | `font-semibold text-slate-800` | hover: `bg-slate-50` | existing status dot (red) |
| **Read, in progress or closed** (`readAt && status != needs_reply`) | `font-medium text-slate-500` | hover: `bg-slate-50` | existing status dot (dimmed) |
| **FYI/quiet** | `font-normal text-slate-400` | `opacity-40` (existing) | dimmed |

**Implementation:** Add `isRead = !!conv.readAt` derived boolean in `AppListColumn`. The existing `isUnread` check stays. The snippet text gets a similar treatment: `text-slate-400` for read conversations, `text-slate-500` for unread (current).

**Key constraint:** Status badge and attention labels remain unchanged — they are the authority on what needs doing. Font weight/color is the read signal only.

**No backend changes needed.** `readAt` already exists on `Conversation` and is set when `conversations/[id]/page.tsx` opens.

**Files:** `app/components/AppListColumn.tsx`

---

## Issue 4: Email Reading Width

### Problem
The desktop conversation view has the email thread column with `px-5` outer padding and `max-w-3xl` + `px-5 py-4` on each message article — double padding. Content doesn't fill the available column width.

### Design
**Desktop:** Remove `max-w-3xl` constraint from the messages container (`mx-auto max-w-3xl space-y-4` → `space-y-4`). Reduce outer scrollable div padding from `px-5 py-4` to `px-3 py-4`. This lets emails use the full resizable column width, which is already bounded by the user's `DesktopResizablePanels` setting.

**Article padding:** Keep `px-5 py-4` on each article card — it reads well at those dimensions and HTML email bodies need breathing room.

**Mobile:** Reduce `px-6 py-5` on article cards to `px-4 py-4` for a tighter reading experience on narrow screens.

**HTML email overflow:** `EmailBody`/`EmailBodyIframe` already handle overflow via `overflow-x-hidden` and iframe sandboxing — no changes needed there.

**Files:** `app/conversations/[id]/page.tsx`

---

## Issue 5: Fix "Open Link" CTA Extraction

### Problem
`extractActionLink(text)` uses the first `https?://` match in the email body. HTML emails (when stripped to text via `stripHtmlToText`) still contain tracking pixels, header logo links, and footer unsubscribe URLs before the real CTA. The result: "Open link" downloads a tracking redirect or opens an unsubscribe page.

### Design
Replace `extractActionLink` with `extractBestActionLink(text: string, actionType?: string): string | undefined`:

**Step 1 — Parse all URLs:**
```
/\bhttps?:\/\/[^\s<>"')]+/gi  (global, case-insensitive)
```
Strip trailing punctuation from each match.

**Step 2 — Filter discard list** (any match in URL path/host):
- `unsubscribe`, `unsub`, `opt-out`, `optout`, `opt_out`
- `pixel`, `/track`, `/open`, `/click` (common tracking endpoints)
- `linkedin.com`, `twitter.com`, `facebook.com`, `instagram.com` (social footer links)
- URLs under 20 chars (too short to be a real CTA)

**Step 3 — Score remaining URLs** (higher = more likely CTA):
- `+3` if path contains action keyword matching `actionType` (e.g. `reset`, `verify`, `confirm`, `activate`, `create-password`, `signup`, `account`, `magic`)
- `+2` if path contains any CTA keyword regardless of type
- `+1` if path length > 40 chars (specific deep links are usually CTAs)
- `-1` if host matches sender domain (likely a self-referential link, not the CTA)

**Step 4:** Return URL with highest score (minimum score 0 to be included), or `undefined`.

All callers of `extractActionLink` are updated to call `extractBestActionLink(text, actionType)` passing the detected action type where known.

The `actionLink` field in `conversationState.metadataJson` is already the correct wire — no schema changes.

**Files:** `lib/agent/email-classifier.ts`

---

## Issue 6: OTP Code Cards with Copy Button

### Problem
`detectedCode` is extracted at classification time in `classifyEmailType()` but only a boolean flag (`hasDetectedCode: true`) is persisted to `conversationState.metadataJson`. The actual code is discarded. The UI shows "Code detected" but users must open the email to copy the code.

### Design

**Backend — persist the code:**
In `work-item-sync.ts`, include `detectedCode` in the persisted action object:
```ts
// Before
hasDetectedCode: Boolean(action.detectedCode),

// After
hasDetectedCode: Boolean(action.detectedCode),
...(action.detectedCode ? { detectedCode: action.detectedCode } : {}),
```

**Type propagation:**
- `lib/agent/command-center.ts`: Add `detectedCode?: string` to `CommandCenterConversation.action`
- Update the mapping in `buildConversation*` to pass `detectedCode` through from `record.action`

**UI — NeedsActionSection:**
When `action.detectedCode` is present:
1. Replace the "Code detected" badge with an inline code display:
   ```
   [123456]  [Copy]
   ```
   - Code pill: `font-mono text-sm bg-violet-50 border border-violet-200 text-violet-900 px-2 py-0.5 rounded`
   - "Copy" button: `text-[10px] font-semibold text-violet-700 hover:text-violet-900`
2. `onClick`: `navigator.clipboard.writeText(action.detectedCode)` — no console.log, no server call
3. Brief "Copied!" flash state (500ms) on the button after copy

**Security constraints:**
- Do NOT log the code (`console.log`, error tracking, etc.)
- The code is already in the full email body stored in the DB — this just surfaces it in the UI
- Codes are temporary (expire in minutes per `expirationText`)

**Files:**
- `lib/agent/work-item-sync.ts` — persist `detectedCode`
- `lib/agent/command-center.ts` — add to type + mapping
- `app/components/NeedsActionSection.tsx` — copy UI

---

## Files Changed Summary

| File | Change |
|---|---|
| `app/conversations/[id]/ReplyComposer.tsx` | Compact composer with expand-on-focus |
| `app/components/InboxScrollContainer.tsx` | New client component for scroll preservation |
| `app/components/AppListColumn.tsx` | Use InboxScrollContainer; 3-tier read/unread styling |
| `app/conversations/[id]/page.tsx` | Reduce email reading padding; remove max-w constraint |
| `app/components/NeedsActionSection.tsx` | OTP code display + copy button |
| `lib/agent/email-classifier.ts` | Replace extractActionLink with extractBestActionLink |
| `lib/agent/work-item-sync.ts` | Persist detectedCode |
| `lib/agent/command-center.ts` | Add detectedCode to type + mapping |

---

## No-change Constraints

- No Prisma migrations — `detectedCode` stores in existing `metadataJson` JSON blob
- Gmail sync and classification flow unchanged
- `AutoRefresh`, `DesktopResizablePanels`, `EmailBody`/`EmailBodyIframe` unchanged
- Mobile layout preserved; only padding values adjusted

---

## Manual QA Checklist

- [ ] Composer is 2 rows tall by default; expands to 5 on click; collapses on blur if empty
- [ ] Pre-loaded AI draft opens composer expanded
- [ ] "Draft with AI" and "Send" buttons always visible regardless of composer state
- [ ] Scroll down the inbox list, open a conversation, go back — list is at same position
- [ ] Changing the filter (All → Reply) resets scroll (expected)
- [ ] Unread email: bold name + blue dot
- [ ] Read email that still needs reply: semibold name, red status dot still visible
- [ ] Read email that is closed/in-progress: muted name (`text-slate-500`)
- [ ] FYI/quiet: opacity-40 as before
- [ ] Email body fills more of the center column with less wasted padding
- [ ] HTML emails do not overflow horizontally
- [ ] "Open link" on a password reset / verify email card opens the CTA URL in a new tab (not a download)
- [ ] "Open link" does not open unsubscribe or tracking links
- [ ] OTP email card shows detected code in monospace pill
- [ ] "Copy" button copies code to clipboard
- [ ] "Copied!" briefly shown after copy
- [ ] OTP code is not logged to browser console
