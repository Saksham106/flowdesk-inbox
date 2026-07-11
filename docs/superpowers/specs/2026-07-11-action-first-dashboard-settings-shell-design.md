# Action-First Dashboard and Persistent Settings Shell Design Spec

Date: 2026-07-11
Status: Approved visual direction; awaiting written-spec review. No product code is changed by this document.

## Intent

Phase 1 simplifies FlowDesk Home into a single place to answer one question: **what needs me next?** It also fixes Settings so opening any `/settings/*` route keeps the same desktop app rail as Mail, Assistant, Clean Inbox, Approvals, and Tools.

The dashboard will no longer present separate permanent sections for Handle First, Needs Action, Tasks & Deadlines, Waiting On, Read Later, agent activity, and quietly handled mail. It will show:

1. three compact daily overview metrics;
2. one ranked, deduplicated action queue;
3. compact Gmail sync health;
4. a collapsed summary of what FlowDesk did;
5. a calm caught-up state when the queue is empty.

Detailed Mail filters, Tasks, Activity, Read Later, and Waiting On remain available through their existing destinations. This phase does not delete those routes or remove their underlying data.

## Success Criteria

- A user can identify their next important action without scanning multiple columns or repeated sections.
- The same conversation or task never appears twice in the Home action queue.
- The queue combines approvals, reply/action conversations, upcoming tasks/deadlines, and stale follow-ups using one stable priority order.
- Home retains enough evidence for the user to trust FlowDesk without turning into an analytics dashboard.
- The desktop `AppRail` remains visible on every Settings page and marks Settings active.
- Mobile remains a single-column experience and does not attempt to render the desktop rail.
- Existing completion, approval, Gmail-label projection, and undo behavior continues to use existing endpoints rather than creating parallel mutation paths.

## Information Architecture

### Page Header

Home opens with a compact greeting/date and the sentence “Here’s what needs your attention.” The right side contains Gmail connection health:

- healthy: “Gmail synced Xm ago”;
- no connected Gmail account: link to `/settings/connect`;
- sync/auth problem: warning treatment linking to `/settings/connect`;
- connected but never synced: “Waiting for first sync.”

The sync status is informational and compact. Existing manual sync controls remain in their current deeper surfaces; Home does not add another large sync panel.

### Daily Overview

Home displays exactly three metrics:

- **Received today:** inbound `Message` records for the tenant with `createdAt` on or after the start of the current server-local calendar day.
- **Handled by FlowDesk:** `ConversationState` rows updated today whose source is neither `user_override` nor `gmail_label`, which currently resolve to a non-action state (`done`, `read_later`, or quietly handled/FYI), and whose conversation has no pending approval. This excludes explicit user/Gmail corrections so the label does not claim credit for the user’s work. It is a trust/value indicator, not an all-time productivity claim.
- **Need you:** the total number of unique items eligible for the unified queue before the display limit is applied.

Metric labels must not say “sent,” “saved,” or “handled automatically” unless the underlying query measures that exact behavior. The cards have equal visual weight except “Need you,” which receives the light blue emphasis used in the approved mockup.

### Unified Action Queue

The queue is a single list, not grouped into permanent subsections. Every item has:

- a type chip (`Approval`, `Reply`, `Action`, `Deadline`, or `Follow up`);
- a concise title;
- one context line containing sender/task source plus age or due date;
- one primary navigation action (`Review` or `Open`);
- a `Done` action only where the existing mutation is safe and semantically valid.

Home displays at most 10 items. The header shows the full unique count and links to `/mail` as “View all in Mail.” Task items may still deep-link to `/tasks` or their source conversation.

#### Sources and Ranking

Items are combined in this order:

1. pending approval requests, oldest pending first;
2. Handle First conversations, using the existing command-center order;
3. overdue tasks/deadlines, earliest due date first;
4. remaining Needs Action conversations, using existing priority/recency order;
5. tasks due within seven days, earliest due date first;
6. stale Waiting On follow-ups, most overdue first.

The queue builder must be a pure helper. It accepts already-loaded view data and returns presentation-ready items; it performs no Prisma queries and no mutations.

#### Deduplication

- A conversation appearing in an earlier source is removed from every later source.
- A task attached to a conversation already represented by an approval or conversation action is excluded from the queue.
- Standalone tasks deduplicate by task ID.
- The full unique count is computed before truncating to 10.

The priority order is the deduplication winner. This makes ranking deterministic and testable.

#### Mutations

- `Review` links to `/approvals` or the relevant approval/conversation destination.
- Conversation `Open` links to `/conversations/[id]`.
- Conversation `Done` uses the existing `PATCH /api/conversations/[id]/workflow-status` request with `workflowStatus: "done"` and retains the existing undo pattern.
- Task `Done` uses the existing `PATCH /api/tasks/[id]/status` request.
- Approval items do not expose `Done`; they require `Review`.
- Failed mutations restore the item, clear pending UI state, and show an inline error. The dashboard must never optimistically hide an item permanently after a failed request.

### FlowDesk Activity Disclosure

Below the queue, a closed `<details>` disclosure labeled “What FlowDesk did today” contains one sentence assembled from existing daily summary facts, such as classified messages, prepared drafts, quietly handled messages, and whether recent feedback updated the learned profile.

This is deliberately collapsed by default. The full activity log remains at `/audit` and is linked from the disclosure. There is no permanent second column and no chart.

### Empty and Partial States

- With no actions: show “You’re caught up” and a short explanation that FlowDesk will surface new decisions here. The three metrics and sync status remain visible.
- With no connected account: show the connection call to action instead of implying the inbox is empty.
- With a sync failure: show the warning and retain any locally available action items.
- With no activity summary: omit empty clauses rather than showing zeros for every agent action.
- Loading continues to use the server-rendered page; no new client-only page-level loading dependency is introduced.

## Component and Data Boundaries

### Pure View Model

Add a focused pure module (recommended: `lib/home-action-feed.ts`) defining a discriminated `HomeActionItem` union and a `buildHomeActionFeed` function. It owns source merging, ranking, deduplication, the 10-item limit, and the pre-limit total. It must not import Prisma, React, or route handlers.

The module should consume existing `DailyCommandCenter`/`BillsSection` data plus normalized pending approval and task inputs. Existing classification and command-center business logic stays in `lib/agent/command-center.ts`; this phase does not duplicate it.

### Server Page

`app/home/page.tsx` remains responsible for authentication, parallel data loading, normalization, and app-shell context. Its queries will be adjusted only to provide:

- actionable pending approval summaries rather than only a count;
- exact daily overview counts;
- the existing command-center and task inputs required by the pure queue builder.

Independent queries remain in one `Promise.all`. Tenant filters are required on every new query.

### Dashboard UI

`app/components/HomeCommandCenter.tsx` becomes the compact page composition for header, metric cards, queue, empty state, and activity disclosure. A focused client component (recommended: `app/components/HomeActionFeed.tsx`) owns optimistic Done/undo/error state. Small presentational components may be split only when they have a clear independent responsibility.

Legacy section components remain in the repository because Mail/Tasks or later phases may still use them. Home simply stops composing them. Unrelated deletion/refactoring is out of scope.

## Persistent Settings Shell

`app/settings/layout.tsx` will follow the existing `app/assistant/layout.tsx` shell pattern:

- authenticate on the server and redirect unauthenticated users to `/login`;
- load `needsReplyCount` and `pendingApprovals` through `getAppShellContext`;
- render desktop as `AppRail` plus a scrollable Settings content column;
- render the current Settings header/tab layout without the rail below `lg`;
- mount `AskFlowDeskPanel` once at the shell level;
- keep `SettingsTabNav` and all existing route-based Settings pages unchanged in purpose.

The Settings rail item already matches every `/settings/*` path, so no navigation-model change is required. The shell must avoid nested full-screen heights that cause two competing scroll containers.

## Responsive Behavior

- Desktop (`lg+`): persistent 56px app rail, one centered dashboard column, maximum readable width close to the approved mockup.
- Mobile/tablet: existing compact Home navigation remains; metrics may stack or use a three-column compact grid when space permits; the action queue always stays one column.
- Inline buttons must wrap without pushing titles off-screen.
- Type chips are supplementary; item meaning must remain understandable from text and accessible labels.

## Accessibility

- Queue type chips are visible text, not color-only signals.
- Sync states use text in addition to colored dots/backgrounds.
- `Done`, `Review`, and `Open` have explicit accessible names including item context where needed.
- Mutation failures are announced through an `aria-live` region.
- Focus remains predictable after completion; undo is keyboard reachable.
- The activity disclosure uses native `<details>/<summary>` behavior.

## Testing

### Pure Unit Tests

Test `buildHomeActionFeed` for:

- priority order across all sources;
- conversation and task/conversation deduplication;
- stable ordering within each source;
- pre-limit total and 10-item truncation;
- approval items never exposing Done;
- empty inputs.

### UI Contract/Component Tests

Verify that Home renders:

- exactly the three approved metric labels;
- one “Your action items” feed;
- no permanent “What needs you,” “Handle first,” “Needs Action,” “Tasks & Deadlines,” “Waiting On,” “Read Later,” or agent pillar headings;
- the collapsed FlowDesk activity disclosure;
- the caught-up state;
- existing workflow/task endpoints for Done and undo/error handling.

Verify Settings layout includes `AppRail`, `getAppShellContext`, and `AskFlowDeskPanel`, and retains the mobile content layout.

### Regression Verification

- Run focused Home/feed/settings tests.
- Run the full Vitest suite.
- Run lint and production build.
- Visually verify `/home` and at least two `/settings/*` routes at desktop and mobile widths with a signed-in fixture/session.
- Confirm the rail remains visible and Settings remains active while navigating between Settings tabs.

## Out of Scope

- Bulk Archive/Bulk Unsubscribe changes.
- Default-label rules and Assistant history corrections.
- New database tables or migrations.
- New analytics charts or revenue widgets.
- Removing existing Mail filters, Tasks, Audit, Waiting On, or Read Later destinations.
- Redesigning the mobile navigation system.
- Changing classifier, automation, or Gmail writeback behavior.

## Approved Direction Summary

The selected direction is the recommended **action-first single feed**. It keeps a small proof-of-value overview and trust signals, but every permanent Home element must either help the user choose their next action or confirm that FlowDesk is operating correctly. Settings adopts the same persistent desktop shell as the rest of the application.
