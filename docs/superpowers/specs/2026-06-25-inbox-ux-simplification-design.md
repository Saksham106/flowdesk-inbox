# FlowDesk Inbox UX Simplification — Design Spec
**Date:** 2026-06-25  
**Status:** Approved

---

## Problem

The app exposes too many overlapping concepts to the user: `ConversationStatus` (needs_reply / in_progress / closed), `attentionCategory` (needs_reply / needs_action / review_soon / read_later / waiting_on / fyi_done / quiet), `emailType` (newsletter / notification / marketing), plus draft state and read/unread. These are mixed together in the UI, creating a confusing "tag manager" experience instead of an AI assistant that quietly sorts email.

Specific symptoms:
- `AttentionCorrectionSelect` shows 7 raw internal categories directly to the user
- "FYI / Done" conflates AI auto-handling with user-initiated done
- Dashboard "Handle First" can show items when the "Needs Reply" count reads 0 (count uses `status`, section uses `topActions` which includes `needsAction`)
- `in_progress` status is semantically ambiguous
- `ReadLaterSection` dismiss writes `fyi_done` (an AI category) when the user just means "done"

---

## Goal

Make FlowDesk feel like an AI assistant that quietly sorts email and only surfaces what the user needs to act on next. The user should see exactly five workflow states and a separate, secondary AI category label.

---

## Architecture Decision: Use `Conversation.userState`

`Conversation.userState` (String?) already exists in the schema and is currently unused in the UI. It was designed for storing explicit user workflow decisions. This becomes the canonical source of truth for user-facing workflow status.

**No DB migration required.** `userState` accepts the five new string values.

---

## User-Facing Workflow Status (5 values)

| Value | Meaning | Set by |
|---|---|---|
| `needs_reply` | User needs to respond | Default; AI or user can set |
| `draft_ready` | AI has drafted a reply to review | Auto-derived from `draft.status === "proposed"` |
| `waiting_on` | User replied, expects a response back | User sets; AI may infer |
| `read_later` | Useful but not urgent | User or AI sets |
| `done` | No action needed / closed | User or AI closes |

---

## Derive Logic

When `userState` is null (i.e., the user hasn't explicitly set a status), derive it:

```
1. draft?.status === "proposed"                          → draft_ready
2. attentionCategory === "waiting_on"                    → waiting_on
3. attentionCategory === "read_later"                    → read_later
4. attentionCategory in ["fyi_done","quiet"]
   OR conversation.status === "closed"                   → done
5. (default)                                             → needs_reply
```

When `userState` is set, it always wins (except `draft_ready` which is always derived from draft state since it's AI-driven).

---

## Secondary AI Category (read-only, shown as context)

Not a control — shown as an explanation in the right rail. Derived from `emailType` + `attentionCategory`:

Newsletter · Notification · Marketing · Receipt/Billing · Security · Personal · Job Alert · Other

---

## Read/Unread

Stays separate from workflow status. No change to existing `readAt` / `gmailUnread` logic.

---

## Components Changed

### New
- `lib/workflow-status.ts` — `deriveWorkflowStatus()`, `aiCategoryLabel()`, API write helper
- `app/conversations/[id]/WorkflowStatusSelect.tsx` — replaces `AttentionCorrectionSelect`
- `app/api/conversations/[id]/workflow-status/route.ts` — PATCH writes `userState`

### Updated
- `app/components/badges.tsx` — 5 new status configs; remove old 3-status config
- `app/components/AppListColumn.tsx` — use `deriveWorkflowStatus()` for status dot/label
- `app/components/ClientFilteredInboxList.tsx` — update `InboxListItem` type + render
- `app/conversations/[id]/page.tsx` — swap `AttentionCorrectionSelect` → `WorkflowStatusSelect`
- `app/components/HandleFirstSection.tsx` — section title stays "Handle First"; description clarifies "Needs Reply + Draft Ready"
- `app/components/HomeCommandCenter.tsx` — stat pills updated to new labels
- `lib/agent/command-center.ts` — fix count/section mismatch: `counts.needsReply` should include draft_ready items shown in Handle First; `safelyIgnored` count matches `sections.safelyIgnored` length
- `app/components/ReadLaterSection.tsx` — dismiss now writes `userState = "done"` instead of `attentionCategory = "fyi_done"`
- `app/components/NeedsActionSection.tsx` — dismiss writes `userState = "done"` instead of `attentionCategory = "fyi_done"`
- `docs/CURRENT_STATE.md` — reflect new model

### Deleted
- `app/conversations/[id]/AttentionCorrectionSelect.tsx` — replaced by `WorkflowStatusSelect`

---

## Dashboard Section Mapping

| Section | Source | Count pill |
|---|---|---|
| Handle First | `topActions` (Needs Reply + Draft Ready) | `counts.needsReply` + draft_ready |
| Waiting On | `sections.waitingOnThem` (attentionCategory=waiting_on OR status=in_progress) | `counts.waitingOnThem` |
| Read Later | `sections.readLater` | `counts.readLater` |
| Quietly Handled | `sections.safelyIgnored` (fyi_done / quiet / auto-email that is closed) | `counts.safelyIgnored` |

Handle First count pill = `needsReply` + `draftReady` count so it matches the items shown.

---

## Left Rail

Status dots/labels updated from `[Needs Reply, In Progress, Closed]` to the derived 5-value set. Filter pills: All · Reply · Draft · Waiting · Read Later · Done (replacing All · Reply · Progress · Closed).

---

## Right Rail (Conversation Detail)

- Replace `AttentionCorrectionSelect` (7 confusing raw categories) with `WorkflowStatusSelect` (5 clean user-facing values + optional Reopen)
- Add a secondary "AI category" display beneath it (read-only, e.g. "Newsletter" in a muted chip)
- Read/unread button stays unchanged

---

## API

`PATCH /api/conversations/[id]/workflow-status`  
Body: `{ status: "needs_reply" | "waiting_on" | "read_later" | "done" }`  
- Writes `userState` on the `Conversation` model
- For `done`, also sets `conversation.status = "closed"` to keep existing close logic consistent
- For `needs_reply`, clears `userState` (null) so derive logic takes over

---

## What is NOT changed

- `ConversationStatus` DB enum (kept as-is: needs_reply / in_progress / closed)
- `attentionCategory` values in DB (kept; just no longer shown raw to user)
- `emailType` values in DB (kept)
- Draft flow, reply composer, approval flow
- Archive / trash / snooze
- Read/unread
- NeedsActionSection (OTP/security cards) stays in Handle First
- Business-only panels: sales, support, calendar holds

---

## Acceptance Criteria

- No giant confusing status dropdown visible to users
- Right rail shows `WorkflowStatusSelect` with 5 options
- AI category shown as read-only secondary chip
- Dashboard counts match dashboard content
- Left rail, right rail, dashboard use consistent language
- Refreshing preserves state
- typecheck / lint / build pass
