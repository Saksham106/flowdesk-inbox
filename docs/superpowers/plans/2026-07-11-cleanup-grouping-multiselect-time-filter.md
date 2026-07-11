# Cleanup Grouping, Multi-Select, and Time Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-backed cleanup time ranges, sender/label grouping, prominent counts, and safe multi-select batch actions to Bulk Archive and Bulk Unsubscribe.

**Architecture:** Pure helpers own range validation/cutoffs and label grouping. Server pages parse URL state and apply the range before Prisma returns the capped candidate population. A shared client table owns grouping display, selection, batch requests, partial failure recovery, and undo.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Prisma 5, Tailwind CSS 4, Vitest 2.

## Global Constraints

- Preserve the existing 400-candidate cap, safety exclusions, safe unsubscribe validation, Gmail archive behavior, and one-hour undo.
- Default range is `quarter`; supported ranges are `week`, `month`, `quarter`, `half_year`, and `all`.
- Bulk Archive supports `group=sender|label`; Bulk Unsubscribe is sender-only.
- Time control must use the same 36px height, radius, slate palette, typography, focus ring, and hover treatment as nearby controls.
- No new dependency or database migration.

---

### Task 1: Pure Range and Label Group Models

**Files:**
- Create: `lib/cleanup-range.ts`
- Modify: `lib/cleanup-candidates.ts`
- Create: `tests/cleanup-range.test.ts`
- Modify: `tests/cleanup-candidates.test.ts`

**Interfaces:**
- Produces `parseCleanupRange(value)`, `cleanupRangeCutoff(range, now)`, `CLEANUP_RANGE_OPTIONS`, and `CleanupLabelGroupView`.
- Extends `summarizeCleanupCandidates` to return `labelGroups` from the same actionable candidates as sender groups.

- [ ] Write failing tests for all valid/invalid range values and exact date cutoffs.
- [ ] Run `npm test -- tests/cleanup-range.test.ts` and confirm missing-module RED.
- [ ] Implement range constants, parser, and cutoff calculation using calendar subtraction from a copied `Date`.
- [ ] Add failing label-group tests covering Newsletter, Marketing, Notification (`notification` + `fyi`), Calendar, Other, count sorting, samples, and safety exclusions.
- [ ] Implement label grouping in `summarizeCleanupCandidates` without changing sender/protected math.
- [ ] Run `npm test -- tests/cleanup-range.test.ts tests/cleanup-candidates.test.ts` and confirm GREEN.
- [ ] Commit with `feat(cleanup): add range and label grouping models`.

### Task 2: Server Query and URL State

**Files:**
- Modify: `lib/cleanup-candidates.ts`
- Modify: `app/clean-inbox/page.tsx`
- Modify: `app/clean-inbox/unsubscribe/page.tsx`
- Modify: `app/clean-inbox/analytics/page.tsx`
- Modify: `tests/cleanup-candidates.test.ts`
- Modify: `tests/dashboard-ui-contracts.test.ts`

**Interfaces:**
- Changes `getCleanupOverview(tenantId, range)` so non-`all` ranges add `lastMessageAt.gte` before `take: 400`.
- Pages normalize `searchParams.range`; Archive also normalizes `searchParams.group`.

- [ ] Add failing source/unit tests proving range cutoff reaches Prisma and pages pass normalized URL state.
- [ ] Run focused tests and confirm RED.
- [ ] Apply cutoff in the candidate query and pass `range`, `groupMode`, `labelGroups`, and current query state into the shared client.
- [ ] Keep Analytics on the same active range and preserve it in cleanup-tab links.
- [ ] Run focused tests and TypeScript; confirm GREEN.
- [ ] Commit with `feat(cleanup): scope candidates by URL time range`.

### Task 3: Styled Table, Group Switcher, and Multi-Select

**Files:**
- Modify: `app/clean-inbox/CleanInboxClient.tsx`
- Modify: `app/clean-inbox/CleanupTabNav.tsx`
- Modify: `tests/dashboard-ui-contracts.test.ts`
- Modify: `tests/cleanup-tabs.test.ts`

**Interfaces:**
- Consumes sender groups, label groups, `range`, `groupMode`, and connection/safety counts.
- Produces the styled URL-backed range select, Archive grouping control, shared selection table, sticky bulk action bar, batch/undo/error states.

- [ ] Add failing UI contracts for `appearance-none`, custom chevron, matching `h-9 rounded-lg`, visible Time range label, From/Emails headers, checkboxes, selection bar, Archive group switcher, and sender-only Unsubscribe.
- [ ] Run focused UI tests and confirm RED.
- [ ] Implement navigation-backed controls using `useRouter`, `usePathname`, and `useSearchParams`, preserving supported query parameters.
- [ ] Implement sender and label table rows sorted by server order, with per-row actions.
- [ ] Implement selected group keys, select-all-visible, unique conversation-ID union, selected group/email totals, one bulk request, failure restoration, `aria-live`, and existing undo token.
- [ ] Ensure mobile rows wrap and the time control fills available width.
- [ ] Run focused tests, TypeScript, and React checklist; confirm GREEN.
- [ ] Commit with `feat(cleanup): add grouped multi-select cleanup table`.

### Task 4: Regression, Documentation, and Visual Verification

**Files:**
- Update: `docs/CURRENT_STATE.md`
- Modify only implementation files required by verification failures.

**Interfaces:**
- Produces a verified and documented phase 2.

- [ ] Run `npm test`; expect all tests passing.
- [ ] Run `npm run lint`; expect zero errors.
- [ ] Run `npm run build`; expect a successful production build.
- [ ] Verify Archive Sender, Archive Label, Unsubscribe, range persistence, selection totals, and mobile layout in browser when the local database schema permits.
- [ ] Document the shipped range/group/multi-select behavior and the styled control requirement in `docs/CURRENT_STATE.md`.
- [ ] Run `git diff --check` and commit with `docs: record cleanup table redesign`.
