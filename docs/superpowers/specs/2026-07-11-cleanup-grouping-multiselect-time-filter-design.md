# Cleanup Grouping, Multi-Select, and Time Filter Design Spec

Date: 2026-07-11
Status: Approved visual direction; awaiting written-spec review. No product code is changed by this document.

## Intent

Phase 2 turns Bulk Archive and Bulk Unsubscribe into clear, count-forward cleanup tables. Users can act on one group or select several groups, while Bulk Archive can group by sender or FlowDesk label. Every cleanup view supports a consistent time-range filter.

The existing safety rules, Gmail archive behavior, safe unsubscribe-link validation, one-hour undo, connection diagnostics, and protected-message exclusions remain authoritative.

## Success Criteria

- Sender rows are sorted from most emails to least and make counts visually prominent.
- Bulk Unsubscribe has a clear From column, sender identity, count, checkbox, and per-row Unsubscribe action.
- Bulk Archive switches between sender and label grouping without changing routes.
- Users can select individual rows, select all visible rows, and run one bulk action.
- Time filtering changes the server query, row counts, selection totals, analytics, and available groups together.
- The time control looks native to the FlowDesk page rather than like an unstyled browser select.
- Partial batch failures remain visible and retryable; successful rows are not repeated.

## Routes and URL State

Existing routes remain:

- `/clean-inbox` — Bulk Archive
- `/clean-inbox/unsubscribe` — Bulk Unsubscribe
- `/clean-inbox/analytics` — Analytics

URL parameters:

- `range=week|month|quarter|half_year|all`, default `quarter`.
- `group=sender|label` on Bulk Archive only, default `sender`.

Changing either control uses normal Next.js navigation and preserves the other supported parameter. Refresh, copy/paste, and tab navigation retain the chosen range. Invalid values normalize to the defaults.

## Time Range

Options and labels:

- `week` — Past week
- `month` — Past month
- `quarter` — Past 3 months
- `half_year` — Past 6 months
- `all` — All synced mail

The server computes a cutoff from the request time and adds `lastMessageAt >= cutoff` to the cleanup candidate query for every range except `all`. The existing `take: 400` remains a hard safety/performance cap, so explanatory copy for `all` says it covers the most recent 400 qualifying conversations in FlowDesk’s synced history.

The active range scopes protected/skipped counts and no-unsubscribe-link counts. It does not filter an already-fetched client list; the server returns only candidates for the range.

## Styled Time Control

The time control is a labeled, compact select placed in the page header opposite the title/count summary. It must use the same visual system as the rest of Clean Inbox:

- white background;
- `border-slate-200` and `rounded-lg`;
- 36px control height matching nearby buttons/segmented controls;
- `text-xs font-medium text-slate-700`;
- a deliberate custom chevron positioned at the right;
- `appearance-none` so the platform-default arrow does not clash;
- `focus-visible:ring-2 focus-visible:ring-blue-500` with no layout shift;
- hover state matching page buttons;
- disabled/loading state using the existing opacity convention.

The label “Time range” remains visible, not placeholder-only. The control must not use a heavy shadow, a different corner radius, or native blue/gray styling that makes it look imported from another product.

On mobile, the header stacks and the control fills the available width. The native select interaction remains available for accessibility and mobile ergonomics; only its visible shell is styled.

## Bulk Archive

### Grouping Control

A two-option segmented control switches between `By sender` and `By label`. It shares the same 36px height, radius, border, text sizing, and focus treatment as the time select. The active segment uses slate-900/white; the inactive segment uses white/slate.

### Sender Table

Columns:

1. selection checkbox;
2. From — sender display name, email, and latest-message age;
3. Emails — prominent count;
4. per-row Archive button.

Rows are sorted by count descending, then latest received descending. Sender email is never truncated without a title/accessible full value.

### Label Table

Rows group the same safe candidates by their resolved FlowDesk content label:

- Newsletter
- Marketing
- Notification
- Calendar
- Other

The label grouping uses `emailType` and the existing Gmail-label mapping semantics (`fyi` folds into Notification). Rows contain checkbox, label name, count, sample sender names, and Archive action. Empty labels are omitted. Rows sort count descending.

## Bulk Unsubscribe

Bulk Unsubscribe always groups by sender because unsubscribe links belong to sender/message relationships, not labels. It uses the same sender table, selection behavior, and time control, with these differences:

- heading/action copy says Unsubscribe;
- only groups with a detected safe unsubscribe URL appear;
- the per-row action is `Unsubscribe` (the backend continues to unsubscribe and archive);
- the bulk action is `Unsubscribe selected`;
- no Sender/Label segmented control appears.

## Selection and Bulk Actions

- Each unresolved row has a checkbox.
- The header checkbox selects/deselects all visible unresolved rows.
- Selection state contains group keys, not duplicated conversation IDs.
- The client derives a unique union of conversation IDs before sending a batch request.
- The sticky selection bar shows selected groups and unique email count.
- Changing time range or grouping navigates and naturally resets selection.
- The bulk action is disabled while a request is running.
- Per-row actions remain available when nothing is selected.

Batch endpoints already accept arrays of conversation IDs and remain unchanged unless response detail is needed for partial-failure presentation.

## Results, Failures, and Undo

- A successful group leaves the active table and displays the existing one-hour Undo affordance.
- Bulk success reports groups and unique emails processed.
- If the route reports a partial result, successful rows resolve while failed rows remain selected/visible with retry copy.
- Network/non-2xx failure restores all affected rows, clears loading state, and announces an inline error via `aria-live`.
- Undo uses the existing batch token. One bulk operation produces one undo token.
- Protected messages never enter selection or request payloads.

## Data and Component Boundaries

### Pure Range Model

Add a pure helper (recommended `lib/cleanup-range.ts`) that validates URL values, returns labels, and computes the cutoff. Pages and tests share this source of truth.

### Candidate Summary

`getCleanupOverview(tenantId, range)` applies the range cutoff in Prisma before mapping. `summarizeCleanupCandidates` remains pure.

Extend the pure summary with label groups. A `CleanupLabelGroupView` contains:

- `label`;
- `count`;
- `sampleSenders`;
- `conversationIds`.

Sender and label grouping use the same actionable candidate set so protected/skipped math stays consistent.

### Client UI

Refactor `CleanInboxClient` into focused table primitives rather than duplicating Archive and Unsubscribe pages:

- header/range control;
- optional grouping control;
- shared selection model and sticky action bar;
- sender rows;
- label rows;
- result/undo state.

The existing server pages remain responsible for auth, app shell, URL parsing, and candidate loading.

## Accessibility

- Table headers describe From/Label and Emails.
- Checkboxes have group-specific accessible labels.
- The select has a visible label and keyboard focus ring.
- Custom chevron is decorative and hidden from assistive technology.
- Bulk selection changes and request results are announced through `aria-live`.
- Count is text, not color-only information.
- Responsive layout preserves row actions and checkbox targets of at least 36px.

## Testing

### Pure Tests

- validate every range and default invalid values to `quarter`;
- compute cutoff boundaries for week/month/quarter/half-year/all;
- group labels using the canonical email-type mapping;
- sort label and sender groups by count;
- keep safety exclusions identical across grouping modes;
- deduplicate conversation IDs for multi-select payloads.

### UI Contracts

- both cleanup action pages render the styled time select;
- Archive renders sender/label grouping control;
- Unsubscribe does not render label grouping;
- From and Emails headers are present;
- header and row checkboxes exist;
- sticky selection bar shows group/email totals;
- bulk endpoints and Undo remain wired;
- styled select includes `appearance-none`, matching radius/height, custom chevron, and focus ring.

### Verification

- focused cleanup tests;
- full Vitest suite;
- lint;
- production build;
- browser verification for Archive Sender, Archive Label, Unsubscribe, time-range navigation, selection, and mobile stacking when the local database schema permits authenticated rendering.

## Out of Scope

- Delete/trash cleanup actions.
- Unsubscribe grouped by label.
- Removing the 400-candidate cap.
- Fetching unsynced historical Gmail mail solely for cleanup.
- Changing classifier or protected-message rules.
- Phase 3 default rules/history correction work.

## Approved Direction Summary

The selected direction is the sortable table with prominent counts, per-row actions, checkboxes, and a sticky bulk-selection bar. Bulk Archive switches between sender and label grouping; Bulk Unsubscribe stays sender-based. All cleanup views share a URL-backed time filter defaulting to the past three months, and that dropdown is deliberately styled to match the rest of the Clean Inbox interface.
