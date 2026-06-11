# Work Item Review Actions — Design

Date: 2026-06-11

## Problem

The task/lead/approval foundation shipped in the previous slice gives us persisted records, but users have no way to act on them:

- Tasks appear in the conversation sidebar but cannot be closed or snoozed.
- Leads appear in the sidebar but have no stage controls.
- The approval queue links to conversation pages — decisions require navigating away.
- Work items only sync when a conversation page is opened, so the command center can show stale data.

## Goal

Give users the minimum controls needed to trust and act on extracted work items, and make sync reliable enough for the command center to be accurate.

## User Stories

1. As a user, I can close a task from the conversation sidebar so I know I handled it.
2. As a user, I can move a lead through pipeline stages (new → contacted → qualified → won / lost) from the sidebar.
3. As a user, I can approve or reject a draft directly from the approval queue without opening the conversation.
4. As a user, work items are up-to-date when I open the inbox, not just when I open a conversation.

## Scope

### In Scope

- Task status actions: close (open → closed). Reopen supported for correction.
- Lead stage controls: new / contacted / qualified / won / lost.
- Approval queue inline decisions: approve or reject with optional note.
- Background sync: call `syncConversationWorkItems` after Gmail and Outlook sync for each upserted conversation.
- Task list page at `/tasks`.
- Leads pipeline page at `/leads`.
- Nav links from inbox to `/tasks` and `/leads`.

### Out of Scope

- Task assignment and manual task creation (future).
- Full CRM reporting (future).
- Autonomous follow-up sequences on stage change (future).
- External task sync (Linear, Notion, etc.) (future).

## Data Model

No new models required. All actions update existing fields:

- `InboxTask.status`: `open` | `closed`
- `Lead.stage`: `new` | `contacted` | `qualified` | `won` | `lost`
- `ApprovalRequest.status`: `pending` | `approved` | `rejected`
- `ApprovalRequest.decidedAt`, `reviewerUserId`, `decisionNote`

## API Design

### PATCH /api/tasks/[id]/status
```json
{ "status": "closed" }
```
Returns the updated task. Writes an `inbox_task.status_changed` audit log entry.

### PATCH /api/leads/[id]/stage
```json
{ "stage": "contacted", "nextAction": "Send follow-up pricing sheet" }
```
Returns the updated lead. Writes a `lead.stage_changed` audit log entry.

### POST /api/approvals/[id]/decide
```json
{ "decision": "approved", "note": "Looks good" }
```
Sets `status`, `decidedAt`, `reviewerUserId`, optional `decisionNote`. Returns the updated approval. Writes an `approval_request.decided` audit log entry.

## UI Design

### WorkItemsPanel (conversation sidebar)

Task rows gain a **Close** button. Closed tasks are hidden. A "show closed" toggle is a future concern.

Lead section gains a **Stage** dropdown with values: new / contacted / qualified / won / lost. Selecting a value calls the stage API immediately.

Both actions use `router.refresh()` to re-render the server component without a full page reload.

### Approval Queue Page

Each approval row gains **Approve** and **Reject** buttons rendered in a client component (`ApprovalActions`). On success the row is removed from the list client-side; failed requests keep the row visible and show an error.

### Task List Page (/tasks)

Server component. Lists all open InboxTasks for the tenant sorted by `dueAt asc nulls last`. Each row shows: title, due date, and a link to the source conversation. Closed tasks are excluded by default.

### Leads Pipeline Page (/leads)

Server component. Lists all Leads for the tenant sorted by `score desc`. Shows: name, company, need, urgency, stage badge, score, and a link to the source conversation.

## Background Sync

`syncConversationWorkItems` is currently only called when a conversation page is opened. This creates stale command-center data.

After `syncGmailChannel` and `syncOutlookChannel` upsert each conversation, call `syncConversationWorkItems` for that `conversationId`. Fire-and-forget with `.catch(() => null)` so a sync failure does not block email import.

## Trust and Safety

- All API routes verify tenant ownership before updating records.
- Every action writes an audit log entry.
- No automated sends happen as a result of these actions — they are purely user corrections.

## Verification

```bash
npm test -- tests/work-item-actions.test.ts
npm test
npm run build
```
