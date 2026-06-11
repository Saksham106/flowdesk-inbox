# Task, Lead, And Approval Foundation Design

## Purpose

The next slice turns FlowDesk's command-center intelligence into durable work records. The Daily Command Center can already infer tasks, opportunities, approval needs, and state at render time. This slice persists the important parts so the product can build reliable task views, lead cards, approval queues, follow-up workflows, and money-impact triage.

## Goals

- Add durable `ConversationState`, `InboxTask`, and `Lead` models.
- Extract first-pass tasks, lead records, and persisted state from existing conversation data.
- Add a dedicated approval queue page that uses the existing `ApprovalRequest` model.
- Show task and lead cards on conversation detail pages.
- Keep all writes tenant-scoped and audited.
- Keep extraction deterministic for this slice. LLM extraction can be layered in later once the persistence and review UX are stable.

## Non-Goals

- Full CRM pipeline.
- External task sync.
- Automatic lead follow-up sequences.
- Autonomous approval decisions.
- LLM-powered attachment or natural-language search.
- Team assignment or shared inbox workflows.

## Product Behavior

### Command Center Persistence

For each conversation, FlowDesk can store a current state:

- state: needs reply, waiting on them, waiting on you, scheduled, done, risky / urgent, opportunity, or FYI only.
- priority: urgent, high, medium, low, or none.
- reason and next action.
- confidence and source.

The initial implementation should upsert this state from the deterministic command-center analyzer.

### Inbox Tasks

FlowDesk should create small tasks for promises, deadlines, bills, forms, contracts, payment issues, and follow-ups.

Example task:

- title: `Send contract`
- dueAt: extracted if a clear date exists
- status: open
- source: deterministic
- source conversation: linked

### Leads

FlowDesk should create or update a lead when a conversation indicates revenue intent:

- name
- company if obvious
- need
- urgency
- budget clues
- score
- stage
- next action
- source conversation

This first lead model should be intentionally lightweight. It should be enough to render a useful card and support later CRM work.

### Approval Queue

The approval queue should show pending approvals across conversations. Each row should link to the conversation and show draft metadata when available:

- contact/thread name.
- risk/confidence.
- reason.
- draft status.
- created time.

Decision actions can remain on the conversation page for this slice; the queue is primarily a navigation and review surface.

## Architecture

Create a pure extraction module:

- `lib/agent/work-items.ts`

Responsibilities:

- Convert a command-center analysis into a persisted-state payload.
- Extract deterministic inbox task candidates.
- Extract deterministic lead candidates.
- Normalize score, stage, and source metadata.

Create a persistence module:

- `lib/agent/work-item-sync.ts`

Responsibilities:

- Tenant-scoped upserts for `ConversationState`, `InboxTask`, and `Lead`.
- Audit logs for created/updated records.
- Idempotency using unique keys where possible.

Pages and route handlers should call the persistence module, not duplicate extraction logic.

## Data Model

Add models:

- `ConversationState`
- `InboxTask`
- `Lead`

Use string enums where Prisma enum churn would slow the slice, unless existing project conventions strongly prefer enum types.

Required relationships:

- `Tenant` has many conversation states, inbox tasks, and leads.
- `Conversation` has one conversation state.
- `Conversation` has many inbox tasks.
- `Conversation` has many leads.

## Error Handling

- Missing messages should not throw; they should produce no tasks/leads and a low-priority state.
- Extraction should not overwrite manually edited records in this slice. Only update records with source `deterministic`.
- If persistence fails for one record, log failure and continue processing other record types where possible.

## Testing

Unit tests:

- Task extraction from promise/deadline/payment language.
- Lead extraction from pricing/demo/setup language.
- No lead extraction from FYI/noise.
- Conversation state payload generation from command-center analysis.

Persistence tests:

- Tenant-scoped upsert inputs.
- Idempotent task/lead creation.
- Audit logs for created records.

UI/build verification:

- `npm test -- tests/work-items.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`

## Rollout Boundary

This slice should be treated as foundation work. It makes FlowDesk remember tasks and leads, but it does not promise full task management, full CRM, or automation sequences yet.
