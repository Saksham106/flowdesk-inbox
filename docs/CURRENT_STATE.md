# FlowDesk Current State

Last updated: 2026-06-11

This file is the codebase-facing companion to `MASTER_PRODUCT_PLAN.md`. It answers: what exists today, what is partial, and what should not be treated as active scope.

## Maintenance Instructions For AI Agents

Update this file whenever code changes what FlowDesk can actually do. Do not leave this file aspirational; that belongs in `MASTER_PRODUCT_PLAN.md`.

Required updates:

- Add new shipped capabilities under the relevant implemented foundation.
- Move items out of "Not Yet Implemented" when they become real product behavior.
- Keep "Partial Features" honest when only infrastructure or a first slice exists.
- Add blocked verification notes when a feature cannot be visually or locally tested.
- Remove stale limitations once tests or code prove they are no longer true.

If this file and the code disagree, fix the doc in the same branch as the code change.

## Product Position

FlowDesk is currently an email-first AI inbox agent for individuals and small businesses. The product is moving from "AI draft replies" toward an "AI chief of staff for your inbox": daily command center, safe handling, follow-ups, relationship context, task extraction, lead detection, and approval-gated automation.

Email is the active channel. SMS/Twilio is not part of the active product path.

## Implemented Foundations

### Auth And Tenancy

- Credentials-based auth with NextAuth.
- Tenant-scoped user model.
- Most server reads and writes are scoped by `tenantId`.

### Email And Calendar Connectors

- Gmail connector routes exist for connect, callback, sync, and disconnect.
- Outlook connector routes exist for connect, callback, sync, and disconnect.
- Google Calendar connector routes exist for connect, callback, and disconnect.
- Calendar availability and calendar hold support exist.

### Inbox Core

- Conversation inbox at `/inbox`.
- Conversation detail pages at `/conversations/[id]`.
- Conversation statuses: `needs_reply`, `in_progress`, `closed`.
- Labels for common AI classifications.
- Manual send path through shared send helper.
- Audit log model and audit page.

### AI Drafting

- OpenAI-backed draft generation.
- Structured draft prompt and parser.
- Business-profile and knowledge-document context.
- Learned reply profile support.
- AI draft panel on conversation pages.
- Draft save, clear, approve, and approved-send flows.
- Draft metadata stores intent, confidence, risk, suggested label, escalation reason, model, prompt version, and context IDs.

### Agent Pipeline

- `AgentJob`, `AgentToolCall`, and `ApprovalRequest` models exist.
- Agent job creation and execution helpers exist under `lib/agent/`.
- Classification, policy checks, availability checks, calendar holds, follow-up batch logic, and autopilot guardrails exist.
- Autopilot settings exist, but category-level autopilot modes are not complete.

### Business And Personal Context

- Business profile settings exist.
- Knowledge document create/list/delete flows exist.
- Personal/learned reply profile infrastructure exists.
- Relationship memory is currently lightweight and derived from existing conversation data, not persisted as a full person-memory system.

### Daily Command Center

First slice implemented:

- `lib/agent/command-center.ts`
- `app/inbox/CommandCenterPanel.tsx`
- `app/digest/DailyBriefSections.tsx`
- `app/conversations/[id]/HandleThisPanel.tsx`
- `tests/command-center.test.ts`

Current behavior:

- Computes needs-reply, waiting, scheduled, risky, opportunity, done, and FYI states.
- Shows a command center on `/inbox`.
- Shows a fuller brief on `/digest`.
- Adds assistant context and a "Handle this" button on conversation pages.

Limitation:

- Command-center state is computed at render time. It is not yet persisted in a `ConversationState` table.

### Task, Lead, And Approval Foundations

First slice implemented:

- `ConversationState`, `InboxTask`, and `Lead` models.
- deterministic extraction helpers in `lib/agent/work-items.ts`.
- tenant-scoped persistence sync in `lib/agent/work-item-sync.ts`.
- approval queue page at `/approvals`.
- conversation sidebar work-items panel.
- tests in `tests/work-items.test.ts` and `tests/work-item-sync.test.ts`.

Current behavior:

- Opening a conversation syncs deterministic state, open tasks, and a lead record when the thread has matching signals.
- Tasks can be extracted from promise, deadline, payment, invoice, and renewal language.
- Leads can be extracted from pricing, demo, setup, and booking language.
- Pending approvals can be reviewed from `/approvals` and opened in their source conversation.

Limitations:

- Task and lead extraction is deterministic and intentionally conservative.
- There is no full task-management workflow yet.
- There is no full CRM pipeline yet.
- Approval decisions still happen on the conversation page, not directly in the queue.

## Partial Features

These exist in some form, but are not product-complete:

- Daily Command Center.
- Handle This button.
- Follow-up brain.
- Relationship memory.
- Knowledge-base replies.
- Personal style matching.
- Sensitive/risky email detection.
- Smart scheduling.
- Approval infrastructure.
- Confidence metadata.
- Action-oriented labels.
- Trust/audit infrastructure.
- Autopilot settings.
- Persisted conversation state.
- First-pass task extraction.
- First-pass lead capture.
- Approval queue.

See `MASTER_PRODUCT_PLAN.md` for phase recommendations and feature statuses.

## Not Yet Implemented As Product Features

- Full task management.
- Full CRM pipeline.
- Persisted relationship/person memory.
- Thread explanation panel powered by LLM summaries.
- Attachment intelligence.
- Natural-language inbox search.
- Ask My Inbox chat.
- Team inbox collaboration.
- Customer support mode.
- Sales agent mode.
- Personal life admin mode.
- Risk radar dashboard.
- Phishing/scam/fraud protection.
- Auto-unsubscribe and bulk safe archive.
- Outcome-based automation.
- Plain-English rule training.
- Multi-step workflows.
- ROI analytics dashboard.
- VIP protection.
- Smart snooze.
- Broad connected-app context.
- Auto-generated playbooks/snippets.
- Second-brain retrieval.
- Auto-personalized outreach.
- One-click Clean My Inbox onboarding.

## Deferred Or Removed

### SMS / Twilio

Twilio and SMS are deferred. The product direction is email-first. Old SMS-first assumptions should not drive new code, docs, or onboarding. If SMS returns later, it should be based on customer demand and should get a fresh spec.

### Old Stacked PR Handoff

The AI Draft MVP PR handoff was removed. The feature is now part of the baseline product and should be documented through this current-state file, tests, and code references rather than old merge instructions.

## Recommended Next Engineering Slice

Build the next layer on top of the new foundation:

1. task status actions and a task list page.
2. lead review/edit actions and a lightweight pipeline view.
3. approval queue decision actions.
4. background sync of work items when Gmail/Outlook conversations are imported or agent jobs complete.

Why this slice:

- The records now exist, but users need controls to review, correct, close, and act on them.
- Syncing only on conversation open is useful for the first slice, but background sync is needed for a reliable command center.

## Verification Baseline

Recent verification after the Daily Command Center work:

```bash
npm test -- tests/command-center.test.ts
npm test -- tests/agent-availability.test.ts
npm test -- tests/work-items.test.ts
npm test -- tests/work-item-sync.test.ts
npm test
npm run lint
npm run build
```

Observed result:

- `npm test`: 158 tests passed across 20 files.
- `npm run lint`: passed.
- `npm run build`: passed.

Browser smoke-test note:

- The unauthenticated app shell rendered at `http://localhost:3000/login` with no console errors.
- Authenticated visual QA was blocked because local Postgres was not running at `localhost:5432`, so the documented seed user could not be created in that environment.
