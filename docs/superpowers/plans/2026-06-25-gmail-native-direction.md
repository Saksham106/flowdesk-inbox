# Gmail-Native Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition FlowDesk as a Gmail-native AI operator that acts inside Gmail while keeping the website as the agent control room.

**Architecture:** Gmail remains the source of truth for visible mailbox actions. FlowDesk stores conversations, classifications, drafts, work items, preferences, and audit logs, then projects trusted state back into Gmail through labels, drafts, read/archive actions, and follow-up labels.

**Tech Stack:** Next.js app router, Prisma/Postgres, Gmail API via `googleapis`, Vitest, existing `AuditLog`, `GmailWritebackQueue`, `Conversation`, `ConversationState`, and `Draft` models.

---

## Product Shift Summary

FlowDesk is moving from an AI inbox/dashboard replacement to a Gmail-native AI email operator. Users should keep working in Gmail; FlowDesk should organize Gmail with readable labels, create Gmail drafts, track waiting/follow-up state, and keep a transparent control room for setup, approvals, settings, activity, and power-user review.

The website should no longer be framed as the daily inbox users must adopt. It should supervise the agent: Gmail connection, automation level, label/rule settings, training, approvals, audit logs, daily brief, and review views.

## Reuse vs Change

### Reuse

- Gmail OAuth scopes already include read, send, and modify in `lib/google.ts`.
- Gmail full and incremental sync already import threads/messages in `lib/google.ts` and are orchestrated by `lib/gmail-sync.ts`.
- Gmail push notifications and watch renewal already exist in `app/api/connectors/gmail/push/route.ts`, `app/api/cron/gmail-watch/route.ts`, and related tests.
- Local conversation state, workflow status derivation, and dashboard sections already map to user-facing concepts through `lib/workflow-status.ts`, `lib/workflow-status-transitions.ts`, and `lib/agent/command-center.ts`.
- Draft generation, draft caching, approval, and send flows exist in `app/api/conversations/[id]/draft/suggest/route.ts` and `app/api/conversations/[id]/draft/send-approved/route.ts`.
- Audit logs already exist through `AuditLog` and are displayed in `app/audit/page.tsx`.
- `GmailWritebackQueue` already provides retryable Gmail mutations for read-state reconciliation.

### Change

- Add a first-class Gmail label projection layer instead of treating labels as dashboard-only metadata.
- Bootstrap FlowDesk labels on Gmail connect and during safe periodic writebacks.
- Queue and process label writebacks alongside mark-read writebacks.
- Convert local workflow states to simple Gmail labels such as `Needs Reply`, `Waiting On`, `Read Later`, `Handled`, and `Autodrafted`.
- Create real Gmail drafts rather than only storing local draft text.
- Replace “inbox replacement” language with “agent control room” language in dashboard settings, navigation, and success banners.
- Add automation levels before any auto-archive, auto-read, or auto-send expansion.
- Add durable Gmail mutation audit entries with enough payload to explain what changed and why.

## Flow Audit

### Gmail Sync

- `lib/google.ts` fetches recent inbox threads and syncs history changes. Reuse this as the ingestion path.
- Gap: sync is inbox-biased (`labelIds: ["INBOX"]` in full sync and history watch), so sent-thread waiting-on tracking will need a sent/outbound path.
- Gap: connect callback imports threads but does not bootstrap labels.
- Priority: P0 for label bootstrap/projection; P1 for sent-thread sync coverage.

### Labels

- `app/api/conversations/[id]/label/route.ts` only supports local business labels: `Lead`, `Reschedule`, `Pricing`, `Complaint`.
- `lib/workflow-status.ts` has Gmail-native-ish states, but no Gmail API label application.
- Gap: no label namespace, no idempotent label creation, no mapping from workflow/conversation state to Gmail labels.
- Priority: P0.

### Drafts

- `app/api/conversations/[id]/draft/suggest/route.ts` creates local proposed drafts and audit logs.
- `app/api/conversations/[id]/draft/send-approved/route.ts` sends approved replies through Gmail but does not create Gmail draft artifacts.
- Gap: users cannot open Gmail and see FlowDesk-created drafts waiting there.
- Priority: P1 after label projection, because drafts need stronger dedupe and threading guarantees.

### Conversation Status

- `app/api/conversations/[id]/workflow-status/route.ts` and `app/api/conversations/[id]/status/route.ts` persist local state and clear drafts/read state.
- Gap: status changes do not update Gmail labels except marking closed threads read.
- Priority: P0 to queue label writebacks whenever state changes.

### Dashboard

- `app/inbox/page.tsx` and `app/components/HomeCommandCenter.tsx` already look like a command center with Handle First, Waiting On, Read Later, and Agent Activity.
- Gap: settings copy and connected success copy still imply imported dashboard inbox behavior.
- Priority: P1 copy and IA refinement after backend label behavior starts working.

### Agent Settings

- `app/settings/page.tsx` includes Gmail connection, training, VIPs, sender rules, follow-up settings, autopilot, AI budget, snippets, and workflows.
- Gap: no automation level selector or label settings panel.
- Priority: P1 for automation levels and P2 for fully configurable label names.

## Prioritized Task List

### P0

- [x] Add canonical FlowDesk Gmail labels and mapping helpers in `lib/gmail-labels.ts`.
- [x] Add idempotent Gmail label creation and thread label modification helpers in `lib/google.ts` or a focused label service.
- [x] Extend `GmailWritebackQueue` processing in `app/api/cron/gmail-writeback/route.ts` to handle label writebacks.
- [x] Queue Gmail label projection from workflow/status changes in `app/api/conversations/[id]/workflow-status/route.ts` and `app/api/conversations/[id]/status/route.ts`.
- [x] Add audit logs for queued/applied Gmail label mutations using `AuditLog`.
- [x] Add Vitest coverage for label mapping, queueing, Gmail API calls, and writeback cron behavior.

### P1

- [ ] Bootstrap labels after Gmail connect in `app/api/connectors/gmail/callback/route.ts`.
- [ ] Create Gmail drafts from proposed drafts using Gmail `users.drafts.create`; store Gmail draft id in `Draft.metadataJson`.
- [ ] Prevent duplicate Gmail drafts with a cache key plus latest message id/thread id.
- [ ] Detect user manual replies during sync and clear/retire stale local drafts.
- [ ] Add automation level settings and copy in `app/settings/page.tsx` and a focused settings component.
- [ ] Update dashboard/settings language to “agent control room” and “Gmail-native actions.”
- [ ] Add label status indicators to conversation and command center views.

### P2

- [ ] Add `gmail_label_mappings` table for customizable labels and per-channel label IDs.
- [ ] Add label configuration UI with visibility toggles.
- [ ] Add sent-mail sync path for waiting-on detection outside `INBOX`.
- [ ] Add Gmail add-on/extension decision doc after backend labels/drafts are validated.
- [ ] Add dashboard analytics for labels applied, drafts created, actions undone, and follow-ups recovered.

## First Implementation Slice

Start with the P0 label projection slice because it changes product behavior inside Gmail without changing schema or introducing destructive automation.

- [x] **Step 1: Write failing tests for label vocabulary and Gmail label API helpers**

Run: `npm test -- tests/gmail-labels.test.ts`

Expected: tests fail because `lib/gmail-labels.ts` and label helpers do not exist yet.

- [x] **Step 2: Implement canonical label mapping**

Create `lib/gmail-labels.ts` with mappings from workflow state and local labels to user-friendly labels.

- [x] **Step 3: Implement Gmail label ensure/apply helpers**

Add helpers that list existing Gmail labels, create missing labels, and modify a thread with the resulting label IDs.

- [x] **Step 4: Extend writeback cron**

Teach `app/api/cron/gmail-writeback/route.ts` to process `apply_labels` jobs.

- [x] **Step 5: Queue label writebacks from status routes**

When a user changes workflow/status, queue `apply_labels` for Gmail conversations and write an audit event.

- [x] **Step 6: Verify**

Run focused tests, then `npm test`, `npm run lint`, and `npm run build`.

- [x] **Step 7: Commit**

Commit the plan and implementation with clear messages.
