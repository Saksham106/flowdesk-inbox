# Default Rules and Recent Email Corrections Design Spec

Date: 2026-07-11
Status: Approved visual direction; awaiting written-spec review. No product code is changed by this document.

## Intent

Phase 3 makes FlowDesk’s built-in labeling behavior visible on Assistant Rules and turns Assistant History into a practical feedback surface for the 20 most recent emails. Users can correct a mistaken label from History, and the existing correction pipeline records that feedback for user-specific learning.

## Success Criteria

- A newly connected user sees the 10 canonical FlowDesk labels as built-in rules without requiring `AgentRule` rows to be seeded.
- Each built-in rule shows a plain-language purpose and its enabled/disabled state from `GmailLabelMapping` semantics.
- Built-in rules are visually separate from custom and learned sender rules.
- History shows the latest 20 tenant-scoped conversations/emails, newest first.
- Each History row shows sender, subject, received time, current canonical FlowDesk label, and Adjust.
- Adjust reuses the existing unified `PATCH /api/conversations/[id]/flowdesk-label` endpoint.
- Successful corrections update the row immediately and failures preserve the previous value with an accessible error.

## Built-In Rules

Assistant Rules adds a **Built-in label rules** section above custom rules. It displays all values in `FLOWDESK_GMAIL_LABEL_NAMES`:

- Needs Reply
- Needs Action
- Waiting On
- Read Later
- Handled
- Autodrafted
- Newsletter
- Marketing
- Notification
- Calendar

These are product rules, not persisted `AgentRule` records. Absence of a `GmailLabelMapping` row means enabled with the canonical name; an explicit mapping row controls `enabled`. This matches the existing Gmail-label settings behavior and avoids duplicate configuration state.

Each row contains label name, a concise explanation, and an Enabled/Disabled badge. The section links to `/settings/gmail` for changes. It does not add a second toggle implementation.

Custom `AgentRule` and learned `SenderRule` summaries remain below under **Your rules**. Existing active/draft/learned statistics apply to user rules only and do not inflate by 10 built-ins.

## Recent Email History

Assistant History changes from raw rule-audit history to **Recent emails**. It queries the 20 most recent tenant conversations ordered by `lastMessageAt desc`, with:

- contact display name and stored sender email;
- latest message subject and timestamp;
- `ConversationState` workflow/attention/email type;
- conversation draft/user state needed by `currentFlowDeskLabel`.

If a conversation has no resolvable canonical label, the UI shows `Unlabeled`. Subject fallback is `(No subject)`, and sender fallback is the stored email or `Unknown sender`.

The existing rule-audit list is not deleted; it moves below a collapsed **Rule change history** disclosure so power users retain access without competing with corrections.

## Adjust Interaction

Each row has an Adjust button that reveals the same canonical label options used by Mail/thread workflow controls through `FLOWDESK_LABEL_OPTIONS`.

Saving sends:

```json
{ "label": "Marketing" }
```

to `PATCH /api/conversations/[id]/flowdesk-label`.

That endpoint remains the single mutation boundary and already performs the required side effects: conversation/workflow update, audit log, `ClassificationCorrection`, preference learning, and Gmail label projection/writeback.

Client behavior:

- only one row editor is open at a time;
- Save is disabled while pending;
- success updates the displayed label and closes the editor;
- failure keeps the editor open, retains the original displayed label, and shows an `aria-live` error;
- Cancel makes no request;
- the thread subject links to `/conversations/[id]`.

## Data and Component Boundaries

### Pure Built-In Rule Presenter

Add a pure helper (recommended `lib/built-in-rule-view.ts`) that accepts canonical label names plus mapping rows and returns `{ label, description, enabled }[]`. It owns absence-means-enabled semantics and is unit tested without Prisma/React.

### Rules Server Page

`app/assistant/rules/page.tsx` loads `GmailLabelMapping` rows alongside existing rules and passes the pure view model into a focused built-in section component. No seed/migration is added.

### History Server Page

`app/assistant/history/page.tsx` loads recent conversations and existing rule audit entries in parallel. It normalizes serializable email rows for a focused client component (recommended `RecentEmailHistory.tsx`). The existing `RuleHistoryList` remains server-fed under the disclosure.

### Shared Label Vocabulary

History imports `FLOWDESK_LABEL_OPTIONS` and `currentFlowDeskLabel` from `lib/flowdesk-label-display.ts`. No new label list or mapping table is introduced.

## Empty, Error, and Responsive States

- No recent mail: explain that emails appear after sync and link to Settings/Connect.
- Missing state: show Unlabeled but still allow Adjust.
- Mobile: rows stack sender/subject, current label, and Adjust; no horizontal-only table dependency.
- Long sender/subject values truncate visually while remaining available through title/text context.
- History query/database errors use the existing route error boundary.

## Accessibility

- Enabled state uses text plus color.
- Adjust/Save/Cancel are buttons with conversation-specific accessible labels.
- Label select has a visible label.
- Errors use `aria-live="polite"`.
- Keyboard focus remains in the row editor until Save/Cancel.
- Subject links are distinguishable and keyboard accessible.

## Testing

### Pure Tests

- all 10 canonical labels appear in canonical order;
- absent mappings default enabled;
- explicit disabled/enabled mappings win;
- descriptions are non-empty;
- current label normalization uses the existing shared helper.

### UI/Route Contracts

- Rules renders Built-in label rules, Enabled/Disabled, and Settings/Gmail link;
- built-ins are not counted as `AgentRule`s;
- History query uses tenant scope, newest-first ordering, and `take: 20`;
- recent rows use `FLOWDESK_LABEL_OPTIONS` and the `/flowdesk-label` endpoint;
- Save/Cancel/loading/error states are present;
- Rule change history remains available in a collapsed disclosure.

### Verification

- focused presenter/history tests;
- full Vitest suite;
- TypeScript, lint, and production build;
- browser verification for Rules, History, one successful/failed adjustment, and mobile layout when the local database schema permits.

## Out of Scope

- Seeding built-ins as `AgentRule` records.
- Adding a second built-in-rule toggle system.
- Changing the correction learning threshold.
- Bulk correction of several recent emails.
- Increasing History beyond 20 or adding pagination in this phase.
- Removing rule audit history.

## Approved Direction Summary

Rules clearly separates the 10 built-in canonical label rules from custom and learned rules. History prioritizes the latest 20 emails and lets users correct labels through the existing unified correction pipeline, while rule-change audit history remains available in a collapsed secondary disclosure.
