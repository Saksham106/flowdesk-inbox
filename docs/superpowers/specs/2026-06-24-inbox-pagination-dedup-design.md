# Inbox Pagination & Dedup Design

**Date:** 2026-06-24  
**Issues:** #65 (Paginate and cap inbox queries), #52 (Duplicate inbox queries)  
**Approach:** Surgical caps + targeted dedup (Approach A)

---

## Problem Summary

Two related issues cause slow inbox loads and unnecessary DB load:

1. **Unbounded `mobileConversations`** — `app/inbox/page.tsx:127` fetches ALL tenant conversations with full includes and no `take` limit. This query runs server-side even on desktop (the `lg:hidden` layout is still SSR'd), making every non-home inbox visit potentially load thousands of rows.

2. **`needsReplyCandidates` take:500** — `AppListColumn` fetches up to 500 full conversation rows (with messages, contact, stateRecord included) purely to count how many are non-FYI. Only the integer result is used.

3. **Duplicate `statusCounts` groupBy** — `inbox/page.tsx:90–94` and `AppListColumn getCachedListData:142–146` both run the same `prisma.conversation.groupBy({ by: ["status"], where: { tenantId } })`. On every desktop inbox visit both run, with only AppListColumn's result being cached.

4. **Uncapped background queries** — `lib/agent/follow-up.ts:20` and `app/api/admin/close-fyi/route.ts:18` fetch all tenant conversations with no limit.

---

## Architecture

No structural changes. All fixes are in-place within existing files. The `unstable_cache` strategy in AppListColumn is preserved.

### Data flow (unchanged)

```
inbox/page.tsx (Server Component)
  ├── statusCounts groupBy  ← keep, pass down as prop
  ├── gmailChannels
  ├── mobileConversations   ← add take:50 + pagination
  ├── commandCenterConversations (home view only)
  └── AppListColumn (Server Component, desktop only visually)
        ├── getCachedListData (unstable_cache, 60s TTL)
        │     ├── conversations findMany take:50
        │     ├── statusCounts groupBy  ← REMOVE, accept from prop
        │     └── needsReplyCandidates  ← REPLACE with count query
        └── renders ClientFilteredInboxList
```

---

## Changes

### 1. Cap `mobileConversations` — `app/inbox/page.tsx`

**Before:** `findMany` with no `take`  
**After:** `findMany` with `take: MOBILE_LIST_LIMIT` (50) and `cursor`/`skip` pagination

Add a `page` search param (integer, default 0). Pass `skip: page * MOBILE_LIST_LIMIT` and `take: MOBILE_LIST_LIMIT + 1` (fetch one extra to detect if there's a next page). Render a "Load more" link on mobile (`?page=N+1`) if the extra row was returned.

```typescript
const MOBILE_LIST_LIMIT = 50

const mobileConversations = !isHomeView
  ? await prisma.conversation.findMany({
      where: { ... },
      orderBy: { lastMessageAt: "desc" },
      skip: mobilePage * MOBILE_LIST_LIMIT,
      take: MOBILE_LIST_LIMIT + 1,  // +1 to detect next page
      include: { messages: { take: 1 }, channel: true, contact: true, stateRecord: { select: {...} } },
    })
  : []

const hasMoreMobile = mobileConversations.length > MOBILE_LIST_LIMIT
const mobileConversationsPage = mobileConversations.slice(0, MOBILE_LIST_LIMIT)
```

Parse `mobilePage` from `searchParams.page` (default 0, clamp ≥ 0).

### 2. Replace `needsReplyCandidates` — `app/components/AppListColumn.tsx`

**Before:** `findMany` with `take: 500`, full includes, then JS-filter to count non-FYI  
**After:** Direct `prisma.conversation.count()` using deterministic stateRecord columns

```typescript
prisma.conversation.count({
  where: {
    tenantId: input.tenantId,
    status: "needs_reply",
    NOT: {
      OR: [
        { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
        { stateRecord: { emailType: { in: ["notification", "newsletter", "marketing"] } } },
        { stateRecord: { state: "fyi_only" } },
      ],
    },
  },
})
```

**Approximation note:** The existing JS filter also applies regex-based heuristics (sender name pattern, body keywords) for conversations that have no stateRecord classification. The DB count skips these, so the badge may be 0–few higher than the filtered count for tenants with many unclassified conversations. This is acceptable: the stateRecord columns are populated by the classification pipeline for virtually all active conversations. Add a comment explaining this.

Update `getCachedListData` return type: `[ConvRow[], needs_reply_count: number]` instead of `[ConvRow[], groupBy[], ConvRow[]]`.

### 3. Pass `statusCounts` into `AppListColumn` — both files

**`app/inbox/page.tsx`:** Already fetches `statusCounts`. Pass it as a new prop to `<AppListColumn statusCounts={statusCounts} ...>`.

**`app/components/AppListColumn.tsx`:** Add optional `statusCounts` prop. In `getCachedListData`, remove the groupBy query when counts are provided externally. If prop is absent (e.g., in `conversations/[id]/page.tsx`), fall back to fetching it.

```typescript
interface Props {
  // ... existing props
  statusCounts?: { status: string; _count: { status: number } }[]
}
```

`getCachedListData` becomes a 2-query function (conversations + needsReply count) when `statusCounts` is provided, 3-query when not.

Update `conversations/[id]/page.tsx` to also pass `statusCounts` if it already has it, or leave as-is to use the fallback.

### 4. Cap background job queries

**`lib/agent/follow-up.ts:20`:** Add `take: 200`, `orderBy: { lastMessageAt: "asc" }` (already present). Cap means the agent processes the 200 oldest non-closed conversations per run. This is fine — runs are periodic.

**`app/api/admin/close-fyi/route.ts:18`:** Add `take: 100`. Admin endpoint, periodic use, cap is sufficient.

---

## Acceptance Criteria

- `mobileConversations` never fetches more than 51 rows per request
- AppListColumn no longer fetches 500 full conversation rows for a count
- Exactly one `statusCounts` groupBy runs per inbox page render (not two)
- Mobile pagination: "Load more" link appears when page has ≥50 conversations, navigates to `?page=N`
- Status filter counts (Needs Reply badge) still display correctly
- Home view (commandCenterConversations, take:25) unchanged
- Typecheck, lint, existing tests pass
- Issues #65 and #52 closed with explanation comments

---

## Testing

- Add a unit test for the `isFyiConversation`-equivalent DB count logic in a new `tests/inbox-pagination.test.ts`:
  - Verify `MOBILE_LIST_LIMIT` is applied
  - Verify `hasMoreMobile` detection
- Check that existing `tests/inbox-fyi.test.ts` still passes (behavior unchanged for the JS filter used in conversation list display)

---

## What does NOT change

- Desktop sidebar: AppListColumn `conversations` query (`take: 50`) — already capped, unchanged
- Home view: `commandCenterConversations` (`take: 25`, `HOME_CONVERSATION_LIMIT`) — unchanged
- Cache invalidation: `inboxTag(tenantId)` tags — unchanged
- Filter behavior (status, sales, attention, search) — unchanged
- FYI filtering in the conversation list display — unchanged (only the count query changes)
