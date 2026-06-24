# Outlook Delta Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver leased, paginated Outlook Inbox delta sync with strict durable webhook intake, bounded cron processing, and renewable Microsoft Graph subscriptions.

**Architecture:** OAuth and low-level Graph access remain in `lib/microsoft.ts`. New focused modules own delta application, notification authentication/queueing, subscription lifecycle, and bounded worker orchestration. Every entry point uses the same atomic-lease delta runner and all externally supplied cursors/client-state values are encrypted or strictly validated.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 5/PostgreSQL, Microsoft Graph REST, Vitest

---

### Task 1: Persist Outlook sync, lease, subscription, and notification state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260624010000_add_outlook_delta_sync/migration.sql`
- Test: `tests/outlook-schema.test.ts`

- [x] **Step 1: Write a failing schema contract test**

Create a source-level schema test that asserts `OutlookCredential` contains encrypted delta/client-state fields, subscription and health timestamps, and lease owner/expiry fields; assert `OutlookSyncEvent` has a unique notification ID plus bounded-worker indexes and cascade relations.

- [x] **Step 2: Run RED**

Run: `npm test -- tests/outlook-schema.test.ts`

Expected: FAIL because the fields/model do not exist.

- [x] **Step 3: Add Prisma schema and SQL migration**

Add these credential fields:

```prisma
deltaLinkEncrypted                 String?
subscriptionId                    String?   @unique
subscriptionExpiresAt             DateTime?
subscriptionClientStateEncrypted  String?
subscriptionLastRenewalAttempt    DateTime?
subscriptionError                 String?
lastSyncMode                      String?
lastSyncStatus                    String?
syncLeaseId                       String?
syncLockExpiresAt                 DateTime?
```

Add `OutlookSyncEvent` with `notificationId @unique`, tenant/channel relations, subscription/resource/change metadata, status/attempt scheduling fields, and indexes on `(status, nextAttemptAt)` and `(tenantId, channelId)`. Add back-relations on `Tenant` and `Channel`. The migration uses nullable columns for zero-downtime deployment and creates matching constraints/indexes.

- [x] **Step 4: Validate and run GREEN**

Run:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm test -- tests/outlook-schema.test.ts
```

Expected: schema valid and test passes.

### Task 2: Extract Graph primitives and implement the leased delta engine

**Files:**
- Modify: `lib/microsoft.ts`
- Create: `lib/outlook-sync.ts`
- Test: `tests/outlook-sync.test.ts`

- [x] **Step 1: Write failing delta and lease tests**

Cover:

- `@odata.nextLink` pages are applied in order and the final `@odata.deltaLink` is encrypted/persisted.
- A configured page cap persists the continuation cursor and returns `hasMore: true`.
- Created and updated messages use idempotent provider/conversation upserts.
- `@removed` deletes the local provider message and recalculates/ closes the affected conversation.
- A held lease returns `skipped: "sync_in_progress"` without Graph access.
- An expired lease is atomically reclaimed.
- Release requires the generated lease owner ID.

- [x] **Step 2: Run RED**

Run: `npm test -- tests/outlook-sync.test.ts`

Expected: FAIL because `runOutlookDeltaSync` does not exist.

- [x] **Step 3: Export low-level Graph types/helpers**

Keep OAuth/send behavior in `lib/microsoft.ts`, export `GraphMessage`, `graphGet`, and a JSON `graphRequest` helper that accepts absolute Graph cursor URLs without logging them. Remove the recent-rescan sync function after callers migrate in Task 5.

- [x] **Step 4: Implement bounded delta processing**

`runOutlookDeltaSync` accepts `{ channelId, tenantId, requestedMode, maxPages? }`. It:

1. Generates a random lease ID and atomically claims an absent/expired lease for two minutes.
2. Decrypts the saved cursor or builds the Inbox delta URL with selected message fields.
3. Processes at most `maxPages` (default 10), persisting encrypted next/final cursors only after page application.
4. Upserts live messages and applies removals idempotently.
5. Classifies the bounded affected-conversation set once.
6. Writes success/error health and releases only its own lease.

Return `{ ok, synced, deleted, pages, hasMore, mode }` or the busy skip result. Detect Graph 410 without logging the cursor, clear it, release the lease, and return a retryable `cursor_reset` result.

- [x] **Step 5: Run GREEN**

Run: `npm test -- tests/outlook-sync.test.ts`

Expected: all delta/lease tests pass.

- [ ] **Step 6: Commit slice**

Commit: `feat: add leased Outlook delta sync engine (#42)`

### Task 3: Add Microsoft Graph subscription lifecycle

**Files:**
- Create: `lib/outlook-subscriptions.ts`
- Test: `tests/outlook-subscriptions.test.ts`

- [x] **Step 1: Write failing subscription tests**

Cover HTTPS requirement/local HTTP skip, no-op for a healthy subscription, PATCH renewal near expiry, POST creation with a random encrypted client state, and create fallback after a missing remote subscription.

- [x] **Step 2: Run RED**

Run: `npm test -- tests/outlook-subscriptions.test.ts`

Expected: FAIL because subscription helpers do not exist.

- [x] **Step 3: Implement subscription helpers**

Create `ensureOutlookSubscription(channelId)` and `deleteOutlookSubscription(channelId)`. Use `/subscriptions`, Inbox resource `me/mailFolders('Inbox')/messages`, `changeType: "created,updated,deleted"`, a six-day expiry, the HTTPS webhook URL derived from `NEXTAUTH_URL`, and encrypted random client state. Store renewal health without sensitive payloads.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/outlook-subscriptions.test.ts`

Commit: `feat: manage Outlook webhook subscriptions (#42)`

### Task 4: Add strict durable webhook intake

**Files:**
- Create: `lib/outlook-notifications.ts`
- Create: `app/api/connectors/outlook/webhook/route.ts`
- Test: `tests/outlook-webhook.test.ts`

- [x] **Step 1: Write failing webhook tests**

Cover plain-text validation-token echo, malformed payload rejection, unknown subscription rejection, constant-time client-state mismatch rejection, accepted batch insertion, and duplicate notification IDs remaining idempotent through `createMany({ skipDuplicates: true })`.

- [x] **Step 2: Run RED**

Run: `npm test -- tests/outlook-webhook.test.ts`

Expected: FAIL because the route and queue helper do not exist.

- [x] **Step 3: Implement queue validation and route**

Validate the whole batch before inserting any event. Resolve credentials by unique subscription ID, decrypt stored client state, compare equal-length buffers with `timingSafeEqual`, map only routing metadata, and return 202 immediately. Never call delta sync from the webhook.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- tests/outlook-webhook.test.ts`

Commit: `feat: queue verified Outlook webhook notifications (#42)`

### Task 5: Add bounded worker and route every sync entry point through delta

**Files:**
- Create: `lib/outlook-worker.ts`
- Create: `app/api/cron/outlook-sync/route.ts`
- Modify: `app/api/connectors/outlook/sync/route.ts`
- Modify: `app/api/connectors/outlook/callback/route.ts`
- Modify: `app/api/connectors/outlook/disconnect/route.ts`
- Test: `tests/outlook-worker.test.ts`
- Test: `tests/outlook-manual-sync.test.ts`

- [x] **Step 1: Write failing worker and route tests**

Cover atomic event claims, duplicate completed-event no-op, busy lease reschedule, partial-round reschedule, completed event, bounded fallback credential selection, renewal invocation, cron bearer rejection, and manual route delegation/202 busy response.

- [x] **Step 2: Run RED**

Run: `npm test -- tests/outlook-worker.test.ts tests/outlook-manual-sync.test.ts`

Expected: FAIL because worker and shared delta delegation do not exist.

- [x] **Step 3: Implement bounded worker and cron route**

Process at most 25 due events, 25 stale credentials, and 25 renewable subscriptions per invocation. Retry busy/partial events without loops, apply bounded backoff to failures, and return counters plus HTTP 500 when processing errors occurred.

- [x] **Step 4: Migrate entry points**

Manual sync and OAuth callback call `runOutlookDeltaSync`; OAuth callback also attempts subscription setup. Disconnect attempts subscription deletion before deleting the tenant-owned Microsoft channel. Preserve cache revalidation and tenant/provider checks.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm test -- tests/outlook-worker.test.ts tests/outlook-manual-sync.test.ts`

Commit: `feat: process Outlook delta sync notifications (#42)`

### Task 6: Document, verify, publish, and report

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/superpowers/plans/2026-06-24-outlook-delta-sync.md`

- [x] **Step 1: Update operations documentation**

Document Microsoft OAuth variables, delegated permissions, redirect URL, public HTTPS webhook URL, five-minute cron schedule and bearer auth, subscription renewal, delta continuation/retry behavior, alert signals, production checklist, and local HTTP limitations.

- [ ] **Step 2: Run migration and complete verification**

Run sequentially:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Apply the migration to the local development database with `npm run db:deploy`, verify `prisma migrate status`, and rerun focused Outlook tests.

- [ ] **Step 3: Commit documentation**

Commit: `docs: document Outlook delta sync operations (#42)`

- [ ] **Step 4: Push, open PR, and update issue**

Push the branch and open a PR with migration/production validation notes. Comment on #42 with files, schema, checks, and the remaining live Microsoft validation checklist. Merge and close only if acceptance criteria are satisfied; otherwise leave #42 open or create a narrowly scoped production-validation follow-up.
