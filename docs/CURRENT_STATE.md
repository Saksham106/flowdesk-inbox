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
- Relationship memory is persisted per contact in `PersonMemory` (summary, preferences, open questions, promised actions) and updated automatically after conversation sync.

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

Review actions and background sync slice implemented:

- `app/api/tasks/[id]/status/route.ts` — PATCH to close or reopen a task.
- `app/api/leads/[id]/stage/route.ts` — PATCH to update lead stage.
- `app/api/approvals/[id]/decide/route.ts` — POST to approve or reject an approval request.
- `app/tasks/page.tsx` — task list page with overdue/upcoming/undated grouping.
- `app/leads/page.tsx` — leads pipeline page sorted by score.
- `app/approvals/ApprovalActions.tsx` — client component with inline approve/reject buttons.
- `app/approvals/ApprovalList.tsx` — client component with draft previews, bulk decisions, and guarded row removal after successful mutations.
- `WorkItemsPanel.tsx` — now a client component with task close button and lead stage dropdown.
- `lib/google.ts` and `lib/microsoft.ts` — `syncConversationWorkItems` called after each conversation upsert during Gmail and Outlook sync.
- Inbox nav now includes Tasks and Leads links.
- Tests in `tests/work-item-actions.test.ts`.

Phase 1 completion slice implemented (commit `0e5926a`):

- `PersonMemory` Prisma model: per-contact persisted memory with summary, preferences, open questions, promised actions, last contact, and message count.
- `lib/agent/person-memory.ts` — deterministic extraction from up to 10 recent conversations (30 messages each); synced automatically from `lib/agent/work-item-sync.ts` after every conversation sync, with an audit-log entry per sync.
- Relationship panel on conversation pages showing summary, promises made, open questions, and preferences.
- `app/api/tasks/[id]/due/route.ts` plus inline due-date editing on `/tasks` (`app/tasks/TaskList.tsx`) — click a date to edit, Enter/Escape/blur to save.
- Approval queue draft preview — each queue item can expand to show the draft text inline.
- Batch select with bulk approve/reject on the approval queue via `app/api/approvals/bulk/route.ts`.
- Follow-up tracker panel on `/inbox` — amber banner listing queued follow-up agent jobs.
- "Safely ignored" collapsible section on `/inbox` driven by `ConversationState` safely-ignored metadata.

Lead follow-up sequences slice implemented:

- `lib/agent/lead-sequence.ts` — three-step sequence (first follow-up after 2 quiet days, second after 4 more, closing after 7 more) for leads in `new`/`contacted`/`qualified` stages.
- Sequence state stored in `Lead.metadataJson.followUpSequence`; no schema change.
- Due steps create `AgentJob` records with trigger `lead_follow_up` (no OpenAI calls from cron; drafting stays on-demand), deduped per conversation per 24h, audited as `lead_sequence.step_queued`.
- Sequence pauses automatically when the lead replies (inbound last message) and stops for `won`/`lost` leads or closed conversations.
- Cron endpoint `GET /api/cron/lead-sequence` protected by `CRON_SECRET`.
- `/leads` rows show sequence progress; the inbox follow-up tracker includes `lead_follow_up` jobs.
- Tests in `tests/lead-sequence.test.ts`.

Weekly value report slice implemented:

- `lib/agent/value-report.ts` — rolling 7-day tenant-scoped counts (drafts created/sent, tasks extracted/closed, leads detected, follow-ups queued, approvals decided, conversations triaged) plus a conservative time-saved estimate (4 min/draft, 3 min/follow-up, 2 min/task, 5 min/lead; nothing double-counted).
- `/reports` page with headline sentence, metric cards, and time-saved card; estimate weights shown transparently in the UI.
- Reports link in the inbox desktop nav and mobile nav strip.
- Computed live from existing records — no new model, no migration, no tracking pipeline.
- Tests in `tests/value-report.test.ts`.

Explain This Thread slice implemented:

- `lib/ai/prompts/explain-thread.ts` — prompt builder (last 25 messages, per-message truncation, direction labels, no-invented-facts and no-liability-admission safety rules), strict JSON schema, tolerant normalizer.
- `explainThreadWithOpenAI` / `explainThread` in `lib/ai/openai.ts` and `lib/ai/provider.ts`, mirroring the draft-reply structured-output pattern.
- `POST /api/conversations/[id]/explain` — tenant-scoped; records `AiUsageEvent` (feature `explain_thread`) on success and failure and writes a `conversation.explained` audit entry with risk level and counts.
- `ExplainThreadPanel` on conversation pages — what happened, what they want, what you need to do, risks/deadlines with a low/medium/high risk badge, suggested next step, refresh.
- Read-only by design: never drafts, sends, or mutates state. Explanations are generated on demand and not persisted.
- Works for both personal and business accounts (no business-profile requirement).
- Tests in `tests/explain-thread.test.ts`.

Current behavior:

- Opening a conversation syncs deterministic state, open tasks, and a lead record when the thread has matching signals.
- Gmail and Outlook sync now also triggers work-item sync for each imported conversation (background, fire-and-forget).
- Tasks can be closed from the conversation sidebar and due dates can be edited from `/tasks`.
- Leads can be moved through stages (new → contacted → qualified → won → lost) from the conversation sidebar or `/leads`.
- Approval queue supports inline approve/reject decisions, bulk decisions, and inline draft previews without navigating to the conversation.
- Tasks are extracted from promise, deadline, payment, invoice, and renewal language.
- Leads are extracted from pricing, demo, setup, and booking language.
- Every contact gets a persisted `PersonMemory` record after sync, surfaced as a relationship panel on conversation pages.
- The inbox shows queued follow-up jobs and a collapsible safely-ignored section.

Limitations:

- Task assignment is not yet implemented.
- Lead scoring is deterministic; LLM-based scoring is not yet implemented.
- Person-memory extraction is deterministic (regex heuristics), not LLM-based, and is not user-editable.
- Lead sequence step timings are fixed (2/4/7 days); there is no settings UI yet.
- Full CRM pipeline reporting is not yet implemented.

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

- Full task management (assignment, manual creation).
- Full CRM pipeline.
- ROI analytics with trends and persisted snapshots (weekly value report exists at `/reports`).
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

The follow-up tracker, persisted `PersonMemory`, conversation relationship panel, lead follow-up sequences, weekly value report, and Explain This Thread panel are now shipped. The remaining Phase 1 gaps, in priority order:

1. Email risk radar — surface deadline, final-notice, unanswered-thread, and sensitive-content signals as a dedicated view.
2. Auto-draft based on user intent — messy instruction to polished reply compose flow.
3. Smart labels taxonomy — action-oriented label set replacing the current limited labels.

See `docs/TODO.md` for the full remaining-work roadmap mapped against the master plan.

## Verification Baseline

Recent verification (2026-06-11, after the Phase 1 completion slice):

```bash
npm test
npm run lint
npm run build
```

Observed result:

- `npm test`: 183 tests passed across 21 files.
- `npm run lint`: passed.
- `npm run build`: passed.

Browser smoke-test note:

- The unauthenticated app shell rendered at `http://localhost:3000/login` with no console errors.
- Authenticated visual QA was blocked because local Postgres was not running at `localhost:5432`, so the documented seed user could not be created in that environment.
