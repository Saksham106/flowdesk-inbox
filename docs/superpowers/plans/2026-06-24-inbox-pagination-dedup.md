# Inbox Pagination & Query Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap all unbounded inbox queries and eliminate duplicate status-count fetches so every inbox/home page load hits the DB a predictable, small number of times.

**Architecture:** Surgical in-place fixes across four files. AppListColumn's internal `getCachedListData` drops from three queries to two (conversations + a fast count); status counts move to a dedicated `getCachedStatusCounts` helper that inbox/page.tsx bypasses by passing its already-fetched counts as a prop. Mobile inbox list gets `take: 51` (detect next page) with offset pagination and a "Load more" link.

**Tech Stack:** Next.js 14 App Router (Server Components), Prisma ORM, `next/cache` (`unstable_cache`), Vitest

---

## File Map

| File | Change |
|---|---|
| `app/components/AppListColumn.tsx` | Remove `needsReplyCandidates` (take:500); add `getCachedStatusCounts`; add optional `statusCounts` prop |
| `app/inbox/page.tsx` | Cap `mobileConversations`; add `mobilePage` / `hasMoreMobile`; pass `statusCounts` to AppListColumn |
| `lib/agent/follow-up.ts` | Add `take: 200` |
| `app/api/admin/close-fyi/route.ts` | Add `take: 100` |
| `tests/inbox-pagination.test.ts` | New — unit tests for pagination helper logic |

---

## Task 1: Replace `needsReplyCandidates` with a DB count in AppListColumn

**Files:**
- Modify: `app/components/AppListColumn.tsx`

This removes the `take: 500` `findMany` that loads full conversation rows just to count non-FYI ones, and replaces it with a fast `prisma.conversation.count()` using the deterministic stateRecord columns. It also splits `getCachedStatusCounts` into its own `unstable_cache` function (used in Task 2 as the fallback when no external counts are provided).

- [ ] **Step 1: Add `getCachedStatusCounts` helper** — insert this function directly above the existing `getCachedListData` function in `app/components/AppListColumn.tsx`:

```typescript
async function getCachedStatusCounts(tenantId: string) {
  return unstable_cache(
    () =>
      prisma.conversation.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { status: true },
      }),
    ["app-list-counts", tenantId],
    { revalidate: 60, tags: [inboxTag(tenantId)] }
  )()
}
```

- [ ] **Step 2: Rewrite `getCachedListData` to return `[ConvRow[], number]`** — replace the entire `getCachedListData` function body. The `Promise.all` drops from 3 queries to 2: conversations (unchanged) + a count query replacing the 500-row `findMany`.

Replace the `return Promise.all([...])` block inside `unstable_cache`'s async callback with:

```typescript
      return Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: { lastMessageAt: "desc" },
          take: 50,
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            contact: true,
            draft: { select: { status: true } },
            stateRecord: { select: { state: true, metadataJson: true, attentionCategory: true, emailType: true } },
            channel: { select: { provider: true } },
          },
        }) as Promise<ConvRow[]>,
        // Count non-FYI needs_reply conversations using deterministic stateRecord columns.
        // Omits body/sender regex heuristics (only apply to fully unclassified convs — rare in practice).
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
        }),
      ])
```

- [ ] **Step 3: Update the component body** — find the three lines starting with `const [conversations, counts, needsReplyCandidates] = await getCachedListData(` and replace the destructuring + countMap computation:

```typescript
  const [conversations, needsReplyCount] = await getCachedListData({
    tenantId,
    status,
    q,
    sales: sales && isBusiness,
  })
  const rawCounts = statusCounts ?? await getCachedStatusCounts(tenantId)
  const countMap = Object.fromEntries(rawCounts.map((r) => [r.status, r._count.status]))
  countMap.needs_reply = needsReplyCount
```

Note: `statusCounts` here refers to the new optional prop added in Step 4 below. The `??` short-circuits — `getCachedStatusCounts` is NOT called when `statusCounts` prop is provided.

- [ ] **Step 4: Add `statusCounts` to the Props interface** — add the optional field after `sales?`:

```typescript
  statusCounts?: { status: string; _count: { status: number } }[]
```

And add it to the function destructuring after `sales = false,`:

```typescript
  statusCounts,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in `AppListColumn.tsx`. Ignore unrelated pre-existing errors if any.

- [ ] **Step 6: Commit**

```bash
git add app/components/AppListColumn.tsx
git commit -m "perf: replace 500-row needsReplyCandidates fetch with DB count in AppListColumn"
```

---

## Task 2: Pass `statusCounts` from inbox/page.tsx into AppListColumn

**Files:**
- Modify: `app/inbox/page.tsx`

`inbox/page.tsx` already fetches `statusCounts` via `prisma.conversation.groupBy` at line ~90. Passing it as a prop to `<AppListColumn>` prevents AppListColumn from calling `getCachedStatusCounts` (the fallback is skipped by the `??` added in Task 1).

- [ ] **Step 1: Find the `<AppListColumn` JSX in the desktop render** (around line 424). Add the `statusCounts` prop:

```tsx
            <AppListColumn
              tenantId={tenantId}
              accountType={accountType}
              status={activeStatus}
              q={q || undefined}
              sales={salesFilter}
              statusCounts={statusCounts}
              gmailChannels={gmailSyncChannels}
              className="w-full shrink-0"
            />
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in `inbox/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/inbox/page.tsx
git commit -m "perf: pass statusCounts prop to AppListColumn to avoid duplicate groupBy"
```

---

## Task 3: Cap `mobileConversations` with offset pagination

**Files:**
- Modify: `app/inbox/page.tsx`

This is the most impactful fix. The unbounded `mobileConversations` query is replaced with `take: MOBILE_LIST_LIMIT + 1` plus `skip` for offset pagination. A "Load more" link appears on mobile when there are more results.

- [ ] **Step 1: Add `page` to the `searchParams` interface** — find `interface Props` at the top of `app/inbox/page.tsx`:

```typescript
interface Props {
  searchParams: { status?: string; q?: string; sales?: string; attention?: string; page?: string };
}
```

- [ ] **Step 2: Add `MOBILE_LIST_LIMIT` constant** — add after the existing `HOME_MESSAGE_LIMIT` constant (around line 38):

```typescript
const MOBILE_LIST_LIMIT = 50
```

- [ ] **Step 3: Parse `mobilePage` from `searchParams`** — add directly after the `attentionFilter` line (around line 80) in `renderInboxPage`:

```typescript
  const mobilePage = Math.max(0, parseInt(searchParams.page ?? "0", 10) || 0)
```

- [ ] **Step 4: Add `take` and `skip` to the `mobileConversations` query** — find the `mobileConversations` `findMany` call (around line 127) and add two lines inside it after `orderBy`:

```typescript
        orderBy: { lastMessageAt: "desc" },
        skip: mobilePage * MOBILE_LIST_LIMIT,
        take: MOBILE_LIST_LIMIT + 1,
```

- [ ] **Step 5: Add `hasMoreMobile` and slice** — immediately after the closing `: []` of the `mobileConversations` ternary, add:

```typescript
  const hasMoreMobile = mobileConversations.length > MOBILE_LIST_LIMIT
  const mobileConversationsPage = mobileConversations.slice(0, MOBILE_LIST_LIMIT)
```

- [ ] **Step 6: Update `displayConversations` to use `mobileConversationsPage`** — find the `const displayConversations = salesFilter ? ...` block (around line 313) and replace all four references to `mobileConversations` in that block with `mobileConversationsPage`:

```typescript
  const displayConversations = salesFilter
    ? mobileConversationsPage.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        return (
          meta !== null &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).isSalesLead === true
        );
      })
    : attentionFilter
    ? mobileConversationsPage.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
        const m = meta as Record<string, unknown>;
        if (attentionFilter === "life_admin") return !!m.lifeAdminType;
        if (attentionFilter === "snoozed") return typeof m.snoozeReminderId === "string";
        return m.attentionCategory === attentionFilter;
      })
    : activeStatus === "needs_reply"
    ? mobileConversationsPage.filter((c) => !isFyiConversation(c))
    : mobileConversationsPage;
```

- [ ] **Step 7: Compute `loadMoreHref`** — add this before the `return (` statement in `renderInboxPage`:

```typescript
  const loadMoreHref = (() => {
    const p = new URLSearchParams()
    if (activeStatus) p.set("status", activeStatus)
    if (q) p.set("q", q)
    if (salesFilter) p.set("sales", "1")
    if (attentionFilter) p.set("attention", attentionFilter)
    p.set("page", String(mobilePage + 1))
    return `/inbox?${p.toString()}`
  })()
```

- [ ] **Step 8: Add "Load more" link in the mobile layout** — find the closing `</div>` of the `<div className="space-y-3">` conversation list in the mobile section (around line 640, just before `</main>`). Add the link after the conversation list `</div>` and before `</main>`:

```tsx
              {hasMoreMobile && (
                <div className="mt-4 text-center">
                  <Link
                    href={loadMoreHref}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Load more
                  </Link>
                </div>
              )}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 10: Commit**

```bash
git add app/inbox/page.tsx
git commit -m "perf: cap mobileConversations at 50 with offset pagination and Load more link"
```

---

## Task 4: Cap background job queries

**Files:**
- Modify: `lib/agent/follow-up.ts`
- Modify: `app/api/admin/close-fyi/route.ts`

Both background endpoints currently fetch all tenant conversations. Capping them ensures they stay predictable even for large tenants; runs are periodic so processing a bounded batch per run is fine.

- [ ] **Step 1: Add `take: 200` to `getStaleConversations` in `lib/agent/follow-up.ts`** — find the `prisma.conversation.findMany` call around line 20. Add `take: 200` after the existing `orderBy`:

```typescript
    orderBy: { lastMessageAt: "asc" },
    take: 200,
```

- [ ] **Step 2: Add `take: 100` to `close-fyi/route.ts`** — find the `prisma.conversation.findMany` call around line 18. Add `take: 100` after `where`:

```typescript
    where: { tenantId, status: "needs_reply" },
    take: 100,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Run existing follow-up tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/follow-up.test.ts
```

Expected: all pass (the cap doesn't change logic, only bounds it).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/follow-up.ts app/api/admin/close-fyi/route.ts
git commit -m "perf: cap background job conversation queries (follow-up: 200, close-fyi: 100)"
```

---

## Task 5: Add pagination unit tests

**Files:**
- Create: `tests/inbox-pagination.test.ts`

Unit tests for the `hasMoreMobile` detection and slice logic extracted from `inbox/page.tsx`. These don't require a DB or Next.js server — they test the pure helper behavior.

- [ ] **Step 1: Write the test file** — create `tests/inbox-pagination.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

// Mirror the pagination logic from inbox/page.tsx so tests stay independent.
function paginateResults<T>(items: T[], limit: number): { page: T[]; hasMore: boolean } {
  return {
    hasMore: items.length > limit,
    page: items.slice(0, limit),
  }
}

describe("inbox mobile pagination", () => {
  it("returns full page when result count equals limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(50)
    expect(hasMore).toBe(false)
  })

  it("detects next page when fetched count exceeds limit", () => {
    // Prisma fetches limit+1 to probe for a next page
    const items = Array.from({ length: 51 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(50)
    expect(hasMore).toBe(true)
  })

  it("returns partial page near end of data", () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    const { page, hasMore } = paginateResults(items, 50)
    expect(page).toHaveLength(23)
    expect(hasMore).toBe(false)
  })

  it("returns empty page for empty result set", () => {
    const { page, hasMore } = paginateResults([], 50)
    expect(page).toHaveLength(0)
    expect(hasMore).toBe(false)
  })

  it("page content does not include the probe item", () => {
    const items = [10, 20, 30, 40, 50, 99] // 6 items, limit=5 → 99 is the probe
    const { page, hasMore } = paginateResults(items, 5)
    expect(page).toEqual([10, 20, 30, 40, 50])
    expect(hasMore).toBe(true)
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/inbox-pagination.test.ts
```

Expected output:
```
✓ tests/inbox-pagination.test.ts (5)
  ✓ inbox mobile pagination (5)
    ✓ returns full page when result count equals limit
    ✓ detects next page when fetched count exceeds limit
    ✓ returns partial page near end of data
    ✓ returns empty page for empty result set
    ✓ page content does not include the probe item
```

- [ ] **Step 3: Commit**

```bash
git add tests/inbox-pagination.test.ts
git commit -m "test: add unit tests for inbox mobile pagination logic"
```

---

## Task 6: Full test suite + GitHub issue comments

**Files:** None modified — verification + GitHub comments only.

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass. The key suites to watch: `inbox-fyi.test.ts`, `follow-up.test.ts`, `phase3-inbox-ui.test.ts`, `inbox-pagination.test.ts`.

- [ ] **Step 2: Typecheck the full project**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Expected: no errors introduced by these changes.

- [ ] **Step 3: Comment on GitHub issue #65**

```bash
gh issue comment 65 --repo $(gh repo view --json nameWithOwner -q .nameWithOwner) --body "$(cat <<'EOF'
Fixed by these commits:

- **`mobileConversations` capped** (`app/inbox/page.tsx`): Added `take: 51` (limit 50 + 1 to probe for next page) and `skip: mobilePage * 50` offset pagination. Mobile list now shows ≤50 conversations with a "Load more" link. Previously this query was unbounded and fetched the entire tenant conversation history on every non-home page load — including on desktop where the mobile layout is hidden but still SSR'd.
- **`needsReplyCandidates` replaced** (`app/components/AppListColumn.tsx`): The `take: 500` `findMany` that loaded 500 full conversation rows purely to count non-FYI ones is replaced with a single `prisma.conversation.count()` using deterministic `stateRecord` columns (`attentionCategory`, `emailType`, `state`). The needs-reply badge count is now a fast index scan rather than a large row fetch. Minor: body/sender regex heuristics (fallback for unclassified convs) no longer contribute to this count — accepted approximation.
- **Background jobs capped**: `lib/agent/follow-up.ts` → `take: 200`; `app/api/admin/close-fyi/route.ts` → `take: 100`.

Closes #65
EOF
)"
```

- [ ] **Step 4: Comment on GitHub issue #52**

```bash
gh issue comment 52 --repo $(gh repo view --json nameWithOwner -q .nameWithOwner) --body "$(cat <<'EOF'
Fixed by these commits:

- **Duplicate `statusCounts` groupBy removed** (`app/components/AppListColumn.tsx` + `app/inbox/page.tsx`): `inbox/page.tsx` already fetches `statusCounts` via `prisma.conversation.groupBy`. This is now passed as a `statusCounts` prop to `<AppListColumn>`, which short-circuits the `getCachedStatusCounts` fallback via `??`. On desktop inbox visits, only one `groupBy` runs instead of two.
- **`getCachedStatusCounts` extracted**: Status counts now have their own `unstable_cache` entry (key: `["app-list-counts", tenantId]`) separate from the conversation list cache. This means status counts are cached once per tenant per 60s regardless of which filter view is active — previously the groupBy was bundled into `getCachedListData` whose cache key includes the active filter, causing a new DB hit for every status tab.
- **`mobileConversations` eliminated as a desktop duplicate**: Capping the mobile query to 50 rows also removes the hidden cost of fetching unbounded conversation data on desktop (where the mobile layout is SSR'd but never displayed).

Closes #52
EOF
)"
```

- [ ] **Step 5: Close both issues**

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh issue close 65 --repo "$REPO"
gh issue close 52 --repo "$REPO"
```

---

## Self-Review

**Spec coverage:**
- ✅ `mobileConversations` capped (Task 3)
- ✅ `needsReplyCandidates` take:500 replaced with count (Task 1)
- ✅ Duplicate `statusCounts` groupBy removed (Task 2)
- ✅ Background jobs capped (Task 4)
- ✅ Mobile "Load more" pagination (Task 3, Step 8)
- ✅ Status filter counts still work — `countMap.needs_reply` now uses DB count; other statuses from groupBy (Task 1, Step 3)
- ✅ Home view unchanged — `commandCenterConversations` (take:25) not touched
- ✅ Tests added (Task 5)
- ✅ GitHub issue comments + close (Task 6)

**Placeholder scan:** No TBDs, no "similar to above", all code blocks are complete.

**Type consistency:** `statusCounts` prop type `{ status: string; _count: { status: number } }[]` matches the Prisma `groupBy` return shape used everywhere. `needsReplyCount: number` from `getCachedListData` matches direct use as `countMap.needs_reply = needsReplyCount`.
