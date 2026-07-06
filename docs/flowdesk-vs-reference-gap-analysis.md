# FlowDesk vs Reference Gap Analysis

This gap analysis compares FlowDesk's current implementation with the reference projects/products researched in `docs/reference-research/`.

## Executive Summary

FlowDesk is no longer just an AI inbox dashboard. The current codebase already contains the core Gmail-native operator foundations:

- Gmail OAuth, full/incremental history sync, Pub/Sub watch/push, sync locks, and invalid-token reauth.
- Gmail writeback for read/archive/trash/unsubscribe plus retry queue.
- Canonical `FlowDesk/*` Gmail labels and user label visibility settings.
- Gmail-native draft create/withdraw.
- Waiting-on/follow-up lifecycle with Gmail-native labels.
- Unified `ApprovalRequest` approval primitive.
- Level 0-5 automation trust ladder.
- Audit log and rollback/undo foundations.
- Outlook OAuth/delta/webhooks, though not full writeback parity.

The biggest remaining gaps are not "can FlowDesk touch Gmail?" They are control, visibility, rule authoring, operational reliability, and polish.

## Gap Matrix

| Area | Reference Pattern | Current FlowDesk | Gap | Priority |
| --- | --- | --- | --- | --- |
| Gmail/Outlook auth and sync | Inbox Zero provider abstraction, Gmail history/watch, Outlook subscriptions, provider health | Gmail strong; Outlook sync exists | Outlook provider issue UX and writeback parity incomplete | P0/P1 |
| Gmail-native labels | Inbox Zero/SaneBox/Fyxer labels/folders as main UX | `FlowDesk/*` labels shipped with mapping/hide settings | Scheduled reconciliation and `Handle First` mapping need cleanup | P0 |
| Gmail-native drafts | GmailDraft/Fyxer/Exo native drafts | `create_draft` and `withdraw_draft` shipped | Need stronger dedup, CC/BCC/body fidelity, edited-draft learning | P1 |
| Thread actions | Inbox Zero provider action vocabulary | Gmail writeback supports key actions | Outlook archive/trash/unsubscribe parity missing | P1 |
| AI rules | Inbox Zero conditions + actions + dry-run | Agent/sender rules exist | Natural-language rule UI, static-first evaluator, dry-run, versions, execution history lacking | P0 |
| Reply tracking | Inbox Zero Reply Zero; Superhuman reminders | Waiting On and Follow Up shipped | Nudge draft, analytics, and evidence display missing | P1 |
| Triage | SaneBox quiet sorting, Fyxer categories, Exo priority | Command center + classifications | Need evidence/confidence/correction history and preserve user-edited fields | P0 |
| Cleanup | Inbox Zero bulk unsubscribe/archive; SaneBox blackhole | Unsubscribe/writeback and Clean Inbox foundations | Grouped cleanup proposals and safe bulk archive not mature | P1 |
| Queues/jobs | Agentic Inbox durable actions; Inbox Zero queues | `GmailWritebackQueue`, agent jobs, crons | Cron health, stale job UI, provider failure dashboard missing | P0 |
| Data model | Inbox Zero Rule/Action/ExecutedRule/RuleHistory | FlowDesk has several rule/job/run models | Rule versioning and action execution visibility less explicit | P0/P1 |
| Audit/safety | Executed actions + audit + undo | Audit log, approvals, rollback foundations | Need human-readable audit timeline and every provider result linked | P0 |
| Human approvals | Draft review, explicit confirmations | Unified approvals shipped | Need rule-aware approvals and "one-off vs teach rule" choices | P1 |
| Onboarding | Fyxer/GmailDraft quick connect + immediate value | Connect/sync settings exist | First-run preview and permission/health checklist need polish | P0 |
| Control-room UX | Dashboard supervises actions | Dashboard still has inbox-dashboard DNA | Copy/IA should move to setup, supervision, analytics, approvals, training | P0 |
| Extension/add-on/MCP | Exo extensions, Inbox MCP, Agentic Inbox MCP | None core | Optional later surface only | P2 |

## Strengths To Keep

- **Trust ladder:** The Level 0-5 automation model is stronger than most references.
- **Approval unification:** `ApprovalRequest` gives FlowDesk a single primitive for human-in-the-loop work.
- **Gmail-native output:** Labels and drafts now land where users work.
- **Waiting-on lifecycle:** FlowDesk already has the Reply Zero-style foundation.
- **Queued writeback:** Retrying provider mutations is the right architecture.
- **Audit-first mindset:** FlowDesk has the foundation for transparent supervision.

## P0 Gaps

### 1. Control-Room UX Repositioning

Problem: The dashboard can still read like an alternative inbox. The target is a control room.

Needed:

- Update home/settings copy and navigation to emphasize setup, supervision, approvals, analytics, audit, and training.
- Make Gmail the primary workspace in onboarding copy.
- Consolidate dashboard sections around "what FlowDesk did", "what needs your approval", and "what it learned."

Likely areas:

- `app/page.tsx`
- `app/components/HomeCommandCenter.tsx`
- `app/components/AgentActivitySection.tsx`
- `app/settings/page.tsx`
- `lib/app-navigation.ts`
- `docs/product-direction.md`

### 2. Rule Authoring, Preview, And History

Problem: References show rules as the center of user trust. FlowDesk has rule pieces but not a polished rules product.

Needed:

- Static-first sender/domain/subject/body rules.
- Natural-language rule compiler that produces explicit conditions/actions.
- Dry-run over recent conversations.
- Rule version history.
- Execution history tied to audits/writebacks.
- "Why matched / why skipped" explanations.

Likely areas:

- `lib/agent/rule-compiler.ts`
- `lib/agent/classify.ts`
- `lib/agent/email-classifier.ts`
- `app/settings/SenderRulesPanel.tsx`
- `app/settings/TrainAgentPanel.tsx`
- Prisma `AgentRule`, `SenderRule`, `AutomationRun`, `AuditLog`

### 3. Audit Timeline And Provider Result Linking

Problem: Audit exists, but the control room needs human-readable explanations and exact provider outcomes.

Needed:

- Conversation-level audit timeline.
- Rule-level audit timeline.
- Link `GmailWritebackQueue` attempts/results to audit entries.
- Include automation level, approval ID, rule ID/version, confidence/evidence, provider action, provider result, and undoability.

Likely areas:

- `app/audit/page.tsx`
- `app/api/audit/[id]/undo/route.ts`
- `lib/gmail-labels.ts`
- `app/api/cron/gmail-writeback/route.ts`
- Prisma `AuditLog`, `GmailWritebackQueue`, `ApprovalRequest`

### 4. Operational Health

Problem: Gmail-native behavior depends on crons and push/watch health. Users and operators need visibility.

Needed:

- Confirm `agent-jobs`, `gmail-writeback`, and `follow-up` crons in deployment.
- Expose stale queues and failed writebacks.
- Show Gmail watch expiration/renewal state.
- Show Outlook subscription/renewal failures.

Likely areas:

- `app/api/cron/*`
- `lib/gmail-sync.ts`
- `lib/outlook-sync.ts`
- `lib/outlook-subscriptions.ts`
- `app/settings/ConnectedAppsPanel.tsx`

### 5. Current Known Correctness Gaps

Needed:

- Preserve user-edited `InboxTask` fields across sync/classification refresh.
- Fix `FlowDesk/Handle First` mapping or remove it from canonical labels.
- Implement or remove the `create_draft` automation step type if still referenced separately from Gmail writeback.
- Schedule label bootstrap/reconciliation maintenance.
- Consolidate duplicate heuristics.

Likely areas:

- `lib/agent/work-item-sync.ts`
- `lib/gmail-labels.ts`
- `lib/agent/follow-up.ts`
- `lib/agent/automation-runner.ts`
- `docs/TODO.md`

## P1 Gaps

### 1. Draft Quality And Learning

Needed:

- Compare AI draft with the sent version and learn preferences.
- Improve CC/BCC and inline image/CID handling.
- Show draft source/evidence and prompt inputs.
- Dedup drafts more aggressively across Gmail and FlowDesk edits.

Likely areas:

- `lib/gmail-drafts.ts`
- `lib/ai/prompts/draft-reply.ts`
- `lib/agent/reply-learning.ts`
- `lib/agent/reply-context.ts`
- `app/conversations/[id]/AIDraftPanel.tsx`
- `app/conversations/[id]/ReplyComposer.tsx`

### 2. Waiting-On Nudge And Analytics

Needed:

- One-click draft follow-up for due `Waiting On` threads.
- Response-time analytics.
- Follow-up debt dashboard.
- Evidence for why a sent message expects a reply.

Likely areas:

- `lib/agent/follow-up.ts`
- `app/components/WaitingOnSection.tsx`
- `app/digest/DailyBriefSections.tsx`
- `app/conversations/[id]/ThreadStatusHeader.tsx`

### 3. Bulk Cleanup And Unsubscribe

Needed:

- Sender/domain grouping with samples and counts.
- Safe archive proposals.
- Unsubscribe proposals with provider writeback and audit.
- Future filters only after explicit approval.

Likely areas:

- `app/clean-inbox/*`
- `lib/agent/unsubscribe.ts`
- `app/conversations/[id]/UnsubscribeButton.tsx`
- `GmailWritebackQueue`

### 4. Outlook Parity

Needed:

- Outlook archive/trash/unsubscribe writeback.
- Outlook label/category projection if product wants parity.
- Better renewal and invalid-token states.

Likely areas:

- `lib/outlook-worker.ts`
- `lib/outlook-sync.ts`
- `lib/outlook-notifications.ts`
- `lib/microsoft.ts`
- `app/settings/DisconnectOutlookButton.tsx`

## P2 Gaps

- Gmail add-on or browser extension for inline status, explanation, and approvals.
- Slack/Telegram approval notifications.
- MCP/API tool surface for external agents.
- Team inbox/shared supervision.
- Advanced analytics and billing-enforced limits.
- Provider-neutral queue refactor if Outlook and other providers become equal citizens.

## Ideas That Fit FlowDesk

- Gmail labels and native drafts as the main daily surface.
- Static-first rules plus AI fallback.
- Dry-run, undo, audit, and approvals.
- User-visible automation trust ladder.
- Sent-mail and draft-edit learning.
- Cleanup proposals, not destructive automation.
- Digest emails and control-room analytics.
- Optional extension/add-on after backend reliability.

## Ideas That Do Not Fit

- Full email client replacement.
- Extension-first architecture.
- Broad auto-send defaults.
- Deleting/trashing mail automatically.
- Hidden "magic" without explanation.
- Provider aggregator dependency as a default architecture choice.
- A large label taxonomy exposed to Gmail by default.
