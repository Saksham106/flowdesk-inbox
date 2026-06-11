# Work Item Review Actions — Implementation Plan

Date: 2026-06-11
Spec: `docs/superpowers/specs/2026-06-11-work-item-review-actions-design.md`

## Files to Create

| File | Purpose |
|------|---------|
| `app/api/tasks/[id]/status/route.ts` | PATCH — update InboxTask status |
| `app/api/leads/[id]/stage/route.ts` | PATCH — update Lead stage |
| `app/api/approvals/[id]/decide/route.ts` | POST — approve or reject ApprovalRequest |
| `app/tasks/page.tsx` | Server page — all open tasks for tenant |
| `app/leads/page.tsx` | Server page — all leads for tenant |
| `app/approvals/ApprovalActions.tsx` | Client component — approve/reject buttons |
| `tests/work-item-actions.test.ts` | Unit tests for new API logic |

## Files to Modify

| File | Change |
|------|--------|
| `app/conversations/[id]/WorkItemsPanel.tsx` | Convert to client component; add task close button and lead stage dropdown |
| `app/approvals/page.tsx` | Mount ApprovalActions client component per row |
| `lib/google.ts` | Call syncConversationWorkItems after each conversation upsert in syncGmailChannel |
| `lib/microsoft.ts` | Call syncConversationWorkItems after each conversation upsert in syncOutlookChannel |
| `app/inbox/page.tsx` (or nav component) | Add Tasks and Leads nav links |
| `docs/MASTER_PRODUCT_PLAN.md` | Update feature statuses and decision log |
| `docs/CURRENT_STATE.md` | Document new routes, pages, and sync behavior |

## Implementation Order

1. API routes (no UI dependencies).
2. WorkItemsPanel upgrade (depends on task + lead routes).
3. Approval queue actions (depends on approval route).
4. New pages: /tasks and /leads (no API dependencies, pure reads).
5. Background sync in google.ts and microsoft.ts.
6. Nav links.
7. Tests.
8. Docs update.
9. Build + test verification.

## Constraints

- Task status update must NOT overwrite a task already closed by a newer sync.
  - The upsert in `syncConversationWorkItems` only updates `title`, `dueAt`, `source`, `sourceMessageId`, `metadataJson` — NOT `status`. So closing a task from the UI is safe.
- Approval decide must set `decidedAt` to `new Date()` and `reviewerUserId` from the session.
- All routes must verify `tenantId` ownership before any write.
- Do not break the existing `syncConversationWorkItems` upsert logic — background sync adds a call after each conversation upsert, it does not replace anything.
