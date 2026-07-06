# Inbox Zero Architecture Research

This is the primary reference for FlowDesk because Inbox Zero is closest to the product shape we want: provider-connected email, AI rules, Gmail/Outlook actions, reply tracking, cleanup, analytics, and auxiliary surfaces around the inbox.

## What It Is

Inbox Zero is an open-source AI email assistant and email app. It connects Gmail and Outlook accounts, lets users define AI/manual rules, classifies and acts on incoming mail, drafts replies, tracks messages that need responses, supports bulk unsubscribe/cleanup, and exposes analytics and integrations.

FlowDesk should not become an Inbox Zero clone. The useful pattern is the operator layer: rules, actions, durable provider operations, history, and native labels/drafts. FlowDesk's product direction is narrower and more Gmail-native: Gmail remains the daily workspace, while FlowDesk becomes the setup, supervision, analytics, approvals, and training control room.

## How It Works At A High Level

The architecture is a monorepo with a web app, worker/process surfaces, shared API package, analytics, and email/provider utilities.

The core loop is:

1. Connect an email account through Google or Microsoft OAuth.
2. Start watch/subscription flows and sync mail/provider metadata.
3. Store account, label, rule, action, execution, message, newsletter, category, and tracker data in Postgres through Prisma.
4. Convert incoming mail into a provider-independent parsed message shape.
5. Evaluate rules. Static conditions are matched deterministically; AI conditions use prompts/classifiers when needed.
6. Materialize an `ExecutedRule` and `ExecutedAction` plan/history.
7. Execute provider mutations through a provider interface: label, archive, draft, reply, send, forward, mark read, spam, move folder, webhook, delayed action, digest, and messaging notification.
8. Track results and expose them in the app, analytics, digests, or external surfaces.

This split is the core idea to adapt: rules and execution history are product primitives, provider clients are implementation details, and every action has observable state.

## Relevant Architecture, Files, And Modules

Key repo areas from `/tmp/flowdesk-reference-repos/inbox-zero`:

- `ARCHITECTURE.md` documents the monorepo, routes, server actions, API routes, queues, Gmail utilities, AI utilities, and bulk unsubscribe flow.
- `apps/web/prisma/schema.prisma` contains the important models:
  - `EmailAccount`: provider account profile, watch state, rules settings, writing style, follow-up settings, digest settings, labels, rules, executions, newsletters, trackers, messages, knowledge, reply memories, and integrations.
  - `Rule`: enabled rule with static fields (`from`, `to`, `subject`, `body`), AI instructions, groups/categories, system type, thread scope, and history.
  - `Action`: rule action with type, label/folder IDs, draft/reply/send fields, webhook URL, delay, and attachments.
  - `RuleHistory`: versioned rule snapshots.
  - `ExecutedRule` and `ExecutedAction`: execution records and planned/applied action details.
  - `EmailMessage`, `ResponseTime`, `ThreadTracker`, `CleanupJob`, `Newsletter`, `ColdEmail`: analytics, tracking, cleanup, and unsubscribe support.
- `apps/web/utils/email/types.ts` defines a provider interface for Gmail/Outlook operations: archive, bulk archive/trash from senders, labels/folders, filters, draft/reply/send/forward, threads, messages, searches, signatures, mark read/spam, unsubscribe blocking, and sent-message queries.
- `apps/web/utils/email/provider.ts`, `google.ts`, `microsoft.ts`, `watch-manager.ts`, `provider-health.ts`: provider creation, failure logging, health/rate-limit handling, and watch/subscription management.
- `apps/web/utils/gmail/*`: Gmail client, history, watch, message/thread operations, draft, reply, label, filter, batch/retry, spam/trash, scopes, permissions.
- `apps/web/utils/outlook/*`: Outlook draft/reply/label/mail parity.
- `apps/web/utils/rule/*`: rule creation, matching helpers, risk checks, sender pattern overlap, learned patterns, feedback, rule-to-text, and history.
- `apps/web/utils/ai/actions.ts`: central action dispatcher for archive, label, draft, reply, send, forward, mark spam/read, star, digest, move folder, webhook, and messaging notifications.
- `apps/web/utils/reply-tracker/*` and `apps/web/utils/follow-up/*`: reply/waiting tracker, outbound handling, label helpers, draft generation, and follow-up behavior.
- `apps/web/utils/unsubscribe.ts`, `utils/senders/unsubscribe.ts`, `utils/actions/unsubscriber.ts`, newsletters models, and cleanup jobs: unsubscribe and cleanup flows.
- `apps/web/utils/queue/*` and `apps/web/store/*-queue.ts`: job/queue abstractions and UI queues for bulk/archive/sender work.
- `apps/web/utils/audit/prisma-extension.ts`: audit infrastructure.
- `docs/essentials/email-ai-personal-assistant.mdx`: user-facing AI rules model.
- `docs/essentials/reply-zero.mdx`: user-facing reply tracking model.
- `docs/openapi.json`: rules/stats API surface.
- `emulate.config.yaml`, e2e tests, and provider-operation tests: provider emulation and regression patterns.

## Auth And Sync Architecture

Inbox Zero keeps the provider account as a first-class entity (`EmailAccount`) rather than scattering Gmail/Outlook fields across feature tables. It stores watch expiration/subscription IDs and last synced history IDs, and it routes provider calls through `EmailProvider`.

What FlowDesk should adapt:

- Keep `GmailCredential`, `OutlookCredential`, sync state, and channel state explicit, but consider converging new behavior through a provider-operation boundary where possible.
- Keep provider health/rate-limit state user visible. FlowDesk already records invalid Gmail token states and should extend this style to Outlook renewal/sync failures.
- Keep watch/subscription renewal and reconcile jobs operationally boring: idempotent, observable, and auditable.

What FlowDesk should avoid:

- Do not introduce a new full email-account abstraction unless it removes real duplication. FlowDesk already has Gmail/Outlook credential models and channels; a thin provider-action interface is enough for the next phases.

## Gmail-Native Labels, Drafts, Archive, Mark-Read, And Thread Actions

Inbox Zero treats provider labels/folders as native output. It creates or resolves labels, stores stable label IDs when available, and performs archive, label, mark-read, draft, reply, send, forward, spam, and folder actions through the provider interface.

FlowDesk status:

- Already has canonical `FlowDesk/*` labels and `GmailLabelMapping`.
- Already queues `apply_labels`, `mark_read`, `archive`, `trash`, `unsubscribe`, `create_draft`, and `withdraw_draft` through `GmailWritebackQueue`.
- Already creates Gmail-native drafts and withdraws them when a draft is cleared/rejected.

Adapt next:

- Generalize writeback rows into a more provider-neutral `ProviderActionQueue` only when Outlook parity demands it. Until then, continue strengthening `GmailWritebackQueue`.
- Keep scheduled label reconciliation healthy so stale/hidden labels and time-based labels remain correct.
- Keep `Handle First` as a dashboard ranking rather than a Gmail label; it changes with command-center ordering and should not churn provider labels.

Avoid:

- Label soup. Inbox Zero supports many categories; FlowDesk should keep the default Gmail taxonomy small and human-readable.

## AI Rules And User-Defined Automation

Inbox Zero's best product architecture is the rule model:

- Conditions can be static (`from`, `to`, `subject`, `body`) or AI instructions.
- Static matching is preferred when possible because it is cheaper and more deterministic.
- Actions are explicit and typed.
- Rules have history and execution records.
- Users can test/dry-run rules before enabling them.
- Some system rules exist, such as reply tracking.

FlowDesk status:

- Has `AgentRule`, `SenderRule`, `rule-compiler.ts`, classification corrections, preference learning, automation runs, `AutopilotSetting.automationLevel`, and approval requests.
- Lacks a polished natural-language rules UI, dry-run simulator, versioned rule history, and clear "why this fired" explanation in the control room.

Adapt next:

- Build static-first rule evaluation: sender/domain/subject/body rules should run before AI classification.
- Add rule previews over recent conversations: matched/not matched, planned labels/drafts/actions, confidence, and audit preview.
- Version user rules and preserve old execution history.
- Make every user-visible automation answer: why did this run, what did it do, what would undo do?

Avoid:

- A giant arbitrary action surface early. Start with label/status/draft/archive/mark-read, then expand.
- Natural-language rules that mutate Gmail without preview.

## Reply Tracking, Waiting-On-Me, And Waiting-On-Them

Inbox Zero's Reply Zero maps two user-visible ideas to provider labels:

- Incoming mail needing a reply is labeled for response.
- Sent mail awaiting another person's reply is labeled as awaiting reply and listed in a waiting view.
- Follow-up/nudge behavior drafts a follow-up rather than silently sending.

FlowDesk status:

- Already ships deterministic waiting-on detection for FlowDesk sends and Gmail-native sends detected during history sync.
- Already self-heals on inbound reply and applies `FlowDesk/Waiting On` and time-based `FlowDesk/Follow Up`.
- Already keeps follow-up automation conservative: labels and dashboard surfacing only, no auto-sent follow-ups.

Adapt next:

- Add a one-click "draft nudge" action for due follow-ups.
- Add clearer waiting-on evidence in the control room: sent date, expected reply reason, due date, and clearing event.
- Track response-time analytics similar to Inbox Zero's `ResponseTime`.

Avoid:

- Auto-sent follow-ups by default. They should require high trust and a narrow rule.

## Inbox Triage And Prioritization

Inbox Zero combines rules, categories, cold-email classification, newsletters, and reply tracking. The key product idea is to separate "needs action" from "can be handled quietly."

FlowDesk status:

- Has command-center sections: Handle First, Needs Action, Read Later, Waiting On, Bills & Deadlines, Agent Activity, and Quietly Handled.
- Has classifications, status derivation, VIP/risk/sales/support modules, and user workflow states.

Adapt next:

- Treat the command center as supervision and analytics, not an inbox replacement.
- Show classification source, confidence, evidence, and correction history.
- Preserve user-edited task/status fields when sync/classification refreshes.

Avoid:

- Making the user triage in two places. Gmail labels should be the daily workflow; FlowDesk should explain and supervise.

## Bulk Unsubscribe, Archive, And Cleanup

Inbox Zero's bulk unsubscribe and cleanup flows are a good post-core reference:

- Detect newsletters and unsubscribe links.
- Group by sender/domain.
- Let users bulk archive/trash/label historical messages.
- Optionally create future filters.
- Keep skip rules such as starred, calendar, receipts, attachments, or conversational threads.

FlowDesk status:

- Has unsubscribe writeback and a clean-inbox area, but not a fully mature grouped sender cleanup workflow.

Adapt next:

- Build "cleanup proposals" first, then one-click approve.
- Default to archive, not trash.
- Show sample messages, estimated count, and undo window before applying.

Avoid:

- Auto-unsubscribe or auto-delete without user confirmation.

## Background Jobs And Queues

Inbox Zero uses queue abstractions and execution records. Agentic Inbox validates a similar conclusion from a different stack: email actions should be durable, idempotent, and retryable.

FlowDesk status:

- `GmailWritebackQueue`, sync locks, Gmail/Outlook jobs, follow-up cron, agent jobs, automation runs, and audit logs already exist.

Adapt next:

- Ensure every mutation has idempotency keys, retry state, provider error classification, and an audit event.
- Add operational dashboards for queues, stale jobs, provider failures, and cron health.
- Confirm production scheduling for `agent-jobs`, `gmail-writeback`, and `follow-up`.

Avoid:

- Direct provider mutations from UI routes when a queued action is safer.

## Database And Data Modeling

Most reusable Inbox Zero modeling ideas:

- Rules and actions are separate.
- Executions are separate from definitions.
- Rule history is versioned.
- Provider-specific stable IDs are stored after resolution.
- Message metadata supports analytics and cleanup.
- Reply trackers are their own lifecycle object.

FlowDesk already has many equivalents:

- `Conversation`, `Message`, `Draft`, `InboxTask`, `AuditLog`, `ApprovalRequest`, `AgentJob`, `AutomationRun`, `GmailWritebackQueue`, `GmailLabelMapping`, `FollowUpSetting`, `AutopilotSetting`, `AgentRule`, and `SenderRule`.

Gap:

- Rule/action/execution modeling is less explicit than Inbox Zero's. FlowDesk should not necessarily copy the schema, but it should make rule versions, dry-run results, and action executions queryable.

## Audit Logs And Automation Safety

Inbox Zero records executed rules/actions and has audit infrastructure. FlowDesk's safety model is stronger in some areas because `ApprovalRequest` is now the single approval primitive and the automation level gates action classes.

Adapt next:

- Connect audits to every Gmail writeback result, not just queued intent.
- Expose an audit timeline per conversation and per rule.
- Show undo availability and limits.
- Add "why" metadata: rule ID/version, confidence, evidence, automation level, approval ID, provider request ID, and result.

Avoid:

- An audit log that is only useful to engineers. The control room should make audits human-readable.

## Human-In-The-Loop Approvals

Inbox Zero relies on user settings, draft review, and opt-in behaviors. FlowDesk has a clearer trust ladder:

- Level 0-1: observe/suggest.
- Level 2: label/status.
- Level 3: create native drafts.
- Level 4: archive/mark-read style non-destructive cleanup.
- Level 5: auto-send only through narrow, confidence-gated rules.

Adapt next:

- Make approval queues rule-aware and explain what future behavior the approval teaches.
- Let users approve a one-off action or convert it into a rule.

Avoid:

- Treating "approve this draft" as approval for future auto-send unless the user explicitly opts in.

## Onboarding And Permission Setup

Inbox Zero, GmailDraft, Fyxer, and SaneBox converge on the same onboarding lesson: users want one-click provider connection, clear permission rationale, and immediate visible value.

FlowDesk status:

- Gmail OAuth, watch setup, sync, and invalid-token reauth CTA exist.

Adapt next:

- Onboarding should show: connected account, sync/watch health, enabled labels, automation level, draft setting, approvals, and a first-run preview before broad writeback.
- Add "first 50 conversations preview" before the agent applies labels to old mail.

Avoid:

- Asking users to configure rules before they see value.

## Dashboard / Control-Room UX

Inbox Zero is a mail app plus settings. FlowDesk should be the opposite: Gmail is the mail app, FlowDesk is the control room.

Control room should contain:

- Setup and permission health.
- Automation level and rules.
- Approvals.
- Audit timeline and undo.
- Analytics: saved time, label distribution, response times, follow-up debt, cleanup opportunities.
- Training: corrections, sender/domain rules, writing style, knowledge.
- Queue/health diagnostics.

Avoid:

- Rebuilding an email list as the primary surface.

## Interaction Surfaces

Inbox Zero supports or explores Slack, Telegram, Teams, browser extension tabs, API, CLI, MCP-like agent work, and digests.

FlowDesk should prioritize:

1. Gmail-native labels and drafts.
2. Dashboard control room.
3. Email digest.
4. Optional Gmail add-on/browser extension for inline explanations and approve/reject affordances.
5. Slack/Telegram/MCP only after the core action layer is reliable.

## Comparison To Current FlowDesk

FlowDesk is already ahead of many references on safety primitives:

- Unified approvals.
- Automation trust ladder.
- Gmail-native labels and drafts.
- Waiting-on lifecycle with self-healing.
- Writeback retry queue.
- Audit table and undo foundations.

FlowDesk is behind Inbox Zero on:

- User-facing rules and dry-run testing.
- Rule/action/version/execution visibility.
- Bulk unsubscribe and cleanup maturity.
- Analytics and response-time reporting.
- Provider abstraction breadth.
- Polished onboarding/control-room UX.
- External interaction surfaces.

The implementation plan should therefore focus less on redoing Gmail-native basics and more on hardening, exposing, and extending the operator layer.
