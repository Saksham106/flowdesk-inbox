# Task Lead Approval Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist task, lead, and conversation-state foundations so FlowDesk can move from inferred command-center signals to durable work records and an approval queue.

**Architecture:** Add Prisma models for `ConversationState`, `InboxTask`, and `Lead`; add pure extraction helpers in `lib/agent/work-items.ts`; add a persistence sync layer in `lib/agent/work-item-sync.ts`; then surface records in an approval queue and conversation sidebar panels. Keep the first extractor deterministic and tenant-scoped.

**Tech Stack:** Next.js 14 App Router, Prisma 5, PostgreSQL, TypeScript, Vitest, Tailwind utility classes.

---

## Files

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260611000000_task_lead_approval_foundation/migration.sql`
- Create: `lib/agent/work-items.ts`
- Create: `lib/agent/work-item-sync.ts`
- Create: `tests/work-items.test.ts`
- Create: `tests/work-item-sync.test.ts`
- Create: `app/approvals/page.tsx`
- Create: `app/conversations/[id]/WorkItemsPanel.tsx`
- Modify: `app/conversations/[id]/page.tsx`
- Modify: `app/inbox/page.tsx`
- Modify: `app/digest/page.tsx`
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/CURRENT_STATE.md`

## Tasks

### Task 1: Pure Extraction Tests

- [x] Write failing tests in `tests/work-items.test.ts` for:
  - task extraction from promise language.
  - task extraction from invoice/payment language.
  - lead extraction from pricing/demo language.
  - no lead from FYI newsletter language.
  - conversation-state persistence payload from command-center analysis.
- [x] Run `npm test -- tests/work-items.test.ts` and confirm it fails because `lib/agent/work-items.ts` is missing.

### Task 2: Pure Extraction Implementation

- [x] Create `lib/agent/work-items.ts`.
- [x] Export deterministic helpers:
  - `buildConversationStateDraft`
  - `extractInboxTaskDrafts`
  - `extractLeadDraft`
  - `summarizeWorkItems`
- [x] Run `npm test -- tests/work-items.test.ts` and make it pass.

### Task 3: Database Models

- [x] Add `ConversationState`, `InboxTask`, and `Lead` models to `prisma/schema.prisma`.
- [x] Add tenant and conversation relations.
- [x] Add indexes and unique keys for idempotent sync.
- [x] Add migration SQL in `prisma/migrations/20260611000000_task_lead_approval_foundation/migration.sql`.
- [x] Run `npx prisma validate`.

### Task 4: Persistence Sync Tests

- [x] Write failing tests in `tests/work-item-sync.test.ts`.
- [x] Mock Prisma calls and verify:
  - tenant-scoped conversation lookup.
  - state upsert.
  - task upsert using deterministic key.
  - lead upsert using conversation unique key.
  - audit logs for sync.
- [x] Run `npm test -- tests/work-item-sync.test.ts` and confirm it fails before implementation.

### Task 5: Persistence Sync Implementation

- [x] Create `lib/agent/work-item-sync.ts`.
- [x] Export `syncConversationWorkItems`.
- [x] Use `buildConversationStateDraft`, `extractInboxTaskDrafts`, and `extractLeadDraft`.
- [x] Write audit logs for `conversation_state.synced`, `inbox_task.synced`, and `lead.synced`.
- [x] Run `npm test -- tests/work-item-sync.test.ts`.

### Task 6: UI Surfaces

- [x] Create `app/approvals/page.tsx`.
- [x] Create `app/conversations/[id]/WorkItemsPanel.tsx`.
- [x] Modify conversation page to load tasks/leads/state and render `WorkItemsPanel`.
- [x] Decide not to modify digest data loading yet; it still uses the command-center analyzer and persisted state is synced on conversation open in this slice.
- [x] Add link to `/approvals` from inbox header.

### Task 7: Docs And Verification

- [x] Update `docs/MASTER_PRODUCT_PLAN.md` statuses for tasks, leads, approval queue, and conversation state.
- [x] Update `docs/CURRENT_STATE.md`.
- [x] Run:
  - `npm test -- tests/work-items.test.ts`
  - `npm test -- tests/work-item-sync.test.ts`
  - `npm test`
  - `npm run lint`
  - `npm run build`
- [x] Record any blocked visual QA in this plan.

Verification result:

- `npm test -- tests/work-items.test.ts`: 7 tests passed.
- `npm test -- tests/work-item-sync.test.ts`: 4 tests passed.
- `npm test`: 158 tests passed across 20 files.
- `npm run lint`: passed.
- `npx prisma validate`: passed.
- `npm run build`: passed and included `/approvals`.

Visual QA note:

- Browser QA was not rerun for this slice because the local database was not available in the previous browser pass. The production build verifies the new route and server component types.
