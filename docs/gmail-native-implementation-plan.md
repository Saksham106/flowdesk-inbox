# Gmail-Native Implementation Plan

This plan turns FlowDesk into a Gmail-native AI email operator. Gmail remains the user's main workspace. FlowDesk becomes the control room for setup, supervision, analytics, approvals, and training.

Companion research:

- `docs/reference-research/inbox-zero-architecture.md`
- `docs/reference-research/email-ai-reference-summary.md`
- `docs/flowdesk-vs-reference-gap-analysis.md`

## Current Ground Truth

Shipped foundations:

- Gmail OAuth connect/callback, encrypted tokens, invalid-token reauth CTA.
- Gmail full and incremental history sync, Pub/Sub push/watch, sync locks.
- Gmail read/archive/trash/unsubscribe writeback and retry queue.
- Canonical flat, colored Gmail labels (`Needs Reply`, `Waiting On`, …; no `FlowDesk/` prefix), `GmailLabelMapping`, and label projection gated by automation level. Legacy `FlowDesk/*` labels are renamed in place or deleted when duplicate flat labels already exist on the next ensure/apply.
- Gmail-native draft creation and withdrawal through writeback.
- Waiting-on/follow-up lifecycle: outbound expected-reply detection, inbound self-healing, `Waiting On` and `Follow Up` labels, follow-up cron sweep, and no auto-sent follow-ups.
- Unified approvals: `ApprovalRequest` is the single approval primitive for proposed drafts and future approval surfaces.
- Level 0-5 automation trust ladder mapped onto existing autonomy/policy/budget/cap gates.
- Dashboard sections for Handle First, Needs Action, Read Later, Waiting On, Agent Activity, and Quietly Handled.
- Outlook OAuth/delta/webhooks exist, but Outlook action parity is incomplete.

Therefore this plan focuses on hardening and exposing the operator layer rather than re-building the Gmail-native basics from scratch.

## Product Principles

1. **Gmail is the workspace.** FlowDesk writes labels, drafts, read/archive/trash/unsubscribe actions, and follow-up status into Gmail.
2. **FlowDesk is the control room.** The dashboard explains what happened, what needs approval, what the agent learned, and where automation is unhealthy.
3. **Static first, AI second.** Deterministic sender/domain/subject/body rules run before LLM classification.
4. **Every mutation is queued, idempotent, auditable, and undo-aware.**
5. **No broad auto-send.** Auto-send requires Level 5, narrow rules, high confidence, policy pass, budget/cap pass, and explicit user intent.
6. **Small human labels beat label soup.** Keep the default Gmail taxonomy compact.
7. **Preview before trust.** New rules and cleanup jobs should dry-run before mutating Gmail.

## Phase 1: Gmail-Native Labels, Drafts, Statuses, And Audit Logs

Status: Core shipped. Remaining work is hardening, reconciliation, correctness, and control-room visibility.

### P0

- ~~Fix or remove `FlowDesk/Handle First` from canonical label projection.~~ Done: removed from the canonical vocabulary — `handle_first` is not producible by any classifier/rule/correction, and the dashboard's Handle First ranking is relative and per-request, not a stable per-thread state.
- ~~Schedule and verify Gmail label bootstrap/reconciliation maintenance.~~ Done in code: `GET /api/cron/gmail-label-reconcile` (ensure labels per channel + bounded re-projection of recently-active conversations). Production scheduling remains in TODO's Ops checklist.
- ~~Link every Gmail writeback result to human-readable audit entries.~~ Done: every writeback resolution writes `gmail.writeback.completed` / `gmail.writeback.failed` with action, conversation/thread, result detail, and error (no schema change needed).
- ~~Preserve user-edited `InboxTask` and workflow fields during sync/classification refresh.~~ Done: user edits mark field ownership (`metadataJson.userEditedFields` + `source: "user"`), sync skips user-owned fields, and label projection honors `conversation.userState`.
- Move dashboard/settings copy toward "Gmail workspace, FlowDesk control room."
  - Areas: `app/page.tsx`, `app/components/HomeCommandCenter.tsx`, `app/settings/page.tsx`, `lib/app-navigation.ts`.

### P1

- Improve Gmail draft fidelity: CC/BCC, inline images/CID, reply headers, and duplicate detection.
  - Areas: `lib/gmail-drafts.ts`, `lib/email-body.ts`, `app/conversations/[id]/ReplyComposer.tsx`.
- Add a conversation-level audit timeline showing label/draft/status changes and undo availability.
  - Areas: `app/audit/page.tsx`, `app/conversations/[id]/AutomationRunHistory.tsx`, `app/conversations/[id]/ExplainThreadPanel.tsx`.
- Expose Gmail watch/sync/writeback health in settings.
  - First slice shipped: Settings renders Gmail operator health from Gmail sync/watch state, recent push failures, Gmail writeback queue health, and agent-job backlog (`lib/gmail-operator-health.ts`, `app/settings/GmailOperatorHealthPanel.tsx`).
  - Remaining: richer operator drilldowns and explicit cron last-run timestamps.

### P2

- Rename/reconcile existing Gmail labels if users rename FlowDesk labels in settings.
- Provider-neutral action queue if Outlook/other providers become equally important.

## Phase 2: AI Rules And User-Controlled Automation

Status: P0 shipped 2026-07-07 (static-first evaluation, dry-run preview, rule versioning + execution history, and the "why this automation fired" control-room UI — per-conversation timeline plus audit-page surfacing).

### P0

- [x] Build static-first rule evaluation for sender/domain/subject/body conditions.
  - Shipped: `lib/agent/static-rules.ts` (shared evaluator; AgentRule over SenderRule, email over domain, AND-ed conditions), gate `tryStaticClassification` in `lib/agent/classify.ts` wired into `lib/agent/jobs.ts` before the budget check — a static match makes no model call and spends no budget.
- [x] Add rule dry-run/preview over recent conversations before enabling.
  - Shipped: `POST /api/agent-rules/dry-run` (bounded 200-conversation sample; matched/skipped, evidence, planned attention/status/Gmail labels with automation-level applicability; zero mutations, one audit row). Draft rules cannot be enabled before a dry-run. UI in `app/settings/SenderRulesPanel.tsx`.
- [x] Version rules and preserve execution history.
  - Shipped: `version` on `AgentRule`/`SenderRule`; prior versions snapshotted to AuditLog (`agent_rule.version_snapshot`) on behavior-changing edits; `GET /api/agent-rules/[id]/versions`; executions record rule id/version (AgentToolCall output, `agent_job.completed` payload). Chose AuditLog metadata over a new table.
- [x] Show "why this automation fired" in the control room.
  - Shipped: per-conversation **"What FlowDesk did"** timeline (`lib/agent/conversation-timeline.ts` — pure/unit-tested; `app/conversations/[id]/ConversationTimeline.tsx`) reads the thread's audit rows (`payloadJson.conversationId`) and renders each action's "why": static rule id/version/evidence, AI confidence, or the acting user. The global `/audit` page now lists the writeback/label/waiting-on/automation-level actions and renders the rule/AI "why" in its Why column. Unmapped/noise actions are omitted so the timeline stays trustworthy.
  - Remaining: draft-source/prompt-input evidence lives with P1 draft-learning; correction-history as its own view is still open.

### P1

- Add "approve once" vs "approve and teach rule" flows.
  - Areas: `app/approvals/*`, `lib/agent/approvals.ts`, rule compiler.
- Let users manually edit sender/domain rules and see learned correction history.
  - Areas: `app/settings/SenderRulesPanel.tsx`, `app/settings/TrainAgentPanel.tsx`, classification correction storage.
- Add safe action vocabulary expansion: archive, mark read, read later, follow-up nudge, webhook.
  - Areas: `lib/agent/automation-runner.ts`, `GmailWritebackQueue`, `AuditLog`.

### P2

- Organization/team shared rules.
- External API/OpenAPI for rules once internal semantics are stable.

## Phase 3: Waiting-On, Reply Tracking, And Cleanup Flows

Status: Waiting-on core shipped. Cleanup and reply analytics remain.

### P0

- Confirm `GET /api/cron/follow-up` is scheduled in production.
  - Areas: deployment cron config, `app/api/cron/follow-up/route.ts`.
- Show waiting-on evidence: detected outbound message, expected-reply reason, due date, and clear event.
  - Areas: `lib/agent/follow-up.ts`, `app/components/WaitingOnSection.tsx`, conversation header/status UI.

### P1

- Add one-click "draft nudge" for due waiting-on threads.
  - Areas: `lib/agent/follow-up.ts`, `lib/ai/prompts/draft-reply.ts`, `app/components/WaitingOnSection.tsx`, approvals/draft writeback.
- Add response-time and follow-up-debt analytics.
  - Areas: command-center snapshots, digest, new analytics queries.
- Build cleanup proposals: sender/domain groups, sample messages, counts, proposed archive/unsubscribe/filter actions, and approval.
  - Areas: `app/clean-inbox/*`, `lib/agent/unsubscribe.ts`, `GmailWritebackQueue`, `AuditLog`.

### P2

- SaneBox-style training from label moves/removals.
- Future auto-archive filters for explicitly approved senders.
- Team cleanup policies.

## Phase 4: Dashboard As Control Room

Status: Dashboard exists but needs IA and copy polish to match the product direction.

### P0

- Reframe home as:
  - "Needs approval"
  - "What FlowDesk did"
  - "What needs training"
  - "Gmail health"
  - "Automation health"
  - "Waiting/follow-up debt"
- Reframe settings as setup and supervision:
  - Connected apps and permission health.
  - Automation level.
  - Gmail labels.
  - Rules.
  - Approvals.
  - Training.
  - Audit/undo.
- Persist command-center snapshots for trend reporting.
  - Areas: `lib/agent/command-center.ts`, Prisma snapshot model if needed, `app/components/HomeStats.tsx`.

### P1

- Add analytics:
  - Label distribution.
  - Drafts created/sent/rejected.
  - Time waiting on others.
  - Quietly handled count.
  - Cleanup opportunity count.
  - Provider/writeback failures.
- Add correction history and source/confidence/evidence on classifications.
- Add queue health panels for operators/users.

### P2

- Daily/weekly digest email with approvals, follow-ups, cleanup proposals, and agent activity.
- Team supervision dashboards.
- Billing/plan enforcement and usage reporting.

## Phase 5: Optional Gmail Add-On, Browser Extension, And Integrations

Status: Not core. Do this only after backend actions, audit, and rules are reliable.

### P1/P2 Candidate Surfaces

- Gmail add-on or browser extension:
  - Show FlowDesk label reason, draft reason, approval buttons, and training buttons inside Gmail.
  - Must call FlowDesk APIs; no DOM scraping as source of truth.
- Slack/Telegram/Teams:
  - Approval notifications and daily digests only.
  - No external auto-send bypass.
- MCP/API:
  - Expose safe read/search/status/propose-action tools first.
  - Require FlowDesk approvals/audit for mutations.
- Calendar/meeting extensions:
  - Borrow Fyxer's meeting-note/follow-up direction after email core is dependable.

## Immediate Next Implementation Order

Coordination: claim one active lane in `docs/TODO.md` or in the PR description before implementing, after pulling the latest `origin/main`.

1. Done: P0 correctness (`Handle First` label removal, label reconciliation cron, user-edited task/workflow preservation).
2. Done: P0 audit result linking for Gmail writebacks.
3. Done: P0 static sender/domain rule editor and dry-run preview.
4. Next P0: control-room copy/IA update.
5. Next P0: operational health for sync/writeback/follow-up crons.
6. P1 draft fidelity and edited-draft learning.
7. P1 waiting-on nudge drafts and analytics.
8. P1 cleanup proposals.
9. P1 Outlook writeback parity.
10. P2 extension/add-on/MCP surfaces.

## Module Map

- Gmail sync/writeback/labels/drafts:
  - `lib/gmail-sync.ts`
  - `lib/gmail-labels.ts`
  - `lib/gmail-drafts.ts`
  - `lib/google.ts`
  - `app/api/cron/gmail-writeback/route.ts`
  - `app/api/connectors/gmail/*`
- Outlook:
  - `lib/outlook-sync.ts`
  - `lib/outlook-worker.ts`
  - `lib/outlook-notifications.ts`
  - `lib/outlook-subscriptions.ts`
  - `lib/microsoft.ts`
- Rules/automation/classification:
  - `lib/agent/rule-compiler.ts`
  - `lib/agent/automation-runner.ts`
  - `lib/agent/workflow-runner.ts`
  - `lib/agent/classify.ts`
  - `lib/agent/email-classifier.ts`
  - `lib/agent/autonomy.ts`
  - `lib/agent/policy.ts`
  - `lib/agent/automation-level.ts`
- Drafting/learning/context:
  - `lib/ai/prompts/draft-reply.ts`
  - `lib/agent/reply-learning.ts`
  - `lib/agent/reply-context.ts`
  - `lib/agent/preference-learning.ts`
  - `lib/agent/person-memory.ts`
- Waiting/follow-up:
  - `lib/agent/follow-up.ts`
  - `lib/business-days.ts`
  - `app/api/cron/follow-up/route.ts`
- Approvals/audit:
  - `lib/agent/approvals.ts`
  - `app/approvals/*`
  - `app/audit/*`
  - `AuditLog`
  - `ApprovalRequest`
- Control room:
  - `app/page.tsx`
  - `app/components/HomeCommandCenter.tsx`
  - `app/components/AgentActivitySection.tsx`
  - `app/components/WaitingOnSection.tsx`
  - `app/settings/*`
  - `lib/agent/command-center.ts`
- Cleanup:
  - `app/clean-inbox/*`
  - `lib/agent/unsubscribe.ts`
  - `app/conversations/[id]/UnsubscribeButton.tsx`

## Definition Of Done For The Gmail-Native Operator

- A user can connect Gmail, leave the dashboard, and see useful labels/drafts/statuses inside Gmail.
- A user can return to FlowDesk and understand exactly what happened, why, what needs approval, and how to undo it.
- A user can define or approve rules only after seeing a dry-run preview.
- Provider mutations are queued, retried, audited, and linked to visible outcomes.
- Waiting-on and follow-up labels remain accurate over time.
- Cleanup is proposal-first and reversible.
- Extensions/integrations are optional surfaces over the same audited backend, not alternate sources of truth.
