# FlowDesk Current State

Last updated: 2026-06-24

This file is the factual snapshot of what the codebase can do today. Strategic roadmap details live in `MASTER_PRODUCT_PLAN.md`; unfinished work lives in `TODO.md`; historical specs and implementation plans live in `docs/archive/`.

## Product Shape

FlowDesk is an email-first AI inbox agent for individuals and small businesses. The active product path is email plus optional Google Calendar. SMS/Twilio is paused.

The core promise is: show what matters, explain why, safely handle routine work, and keep humans in control of sends and risky actions.

## Implemented Foundations

### Auth, Tenancy, And Modes

- Credentials auth through NextAuth.
- Tenant-scoped reads/writes across primary app routes.
- `Tenant.accountType` controls product mode: `personal` or `business`.
- `lib/account-mode.ts` provides personal-safe defaults when account type is missing or unknown.
- Personal accounts hide CRM/sales/business labels and use personal classification/drafting behavior.
- Business accounts can use business profile, knowledge base, CRM labels, sales/support signals, lead scoring, and revenue reporting.

### Connectors

- Gmail connect/callback/sync/push/watch/disconnect routes exist.
- Outlook connect/callback/sync/disconnect routes exist.
- Google Calendar connect/callback/disconnect and calendar hold support exist.
- MindBody has an optional business-mode connector foundation.
- Gmail sync uses per-channel locking, idempotent message upserts, durable push-event tracking, partial thread-failure logging, push/watch health, app-load/tab-return/stale fallback sync, and a manual sync control that updates status without full page refresh.
- Gmail watch renewal records per-channel health, audit-log entries, and monitor-visible cron failures. History cursor fallback is timestamped for UI visibility.

### Inbox And Thread Experience

- `/inbox` Home shows the command center, follow-ups, bills/deadlines, safely ignored mail, and other high-signal sections.
- `/inbox` Home keeps its initial command-center query bounded and reuses included conversation state instead of issuing a duplicate state lookup.
- Inbox list tabs support status, sales, and attention-oriented filtering.
- Inbox list data uses a short tenant-scoped cache tag and indexed `ConversationState` filter columns for common sales/attention filters.
- Inbox list and mobile Reply filters use shared FYI/quiet heuristics so unclassified automated mail is not merely relabeled while still appearing in Needs Reply.
- Inbox auto-refresh polls lightweight summary data once per minute instead of forcing full route re-renders; search filters loaded rows immediately and defers URL/server search until pause or Enter.
- Conversation detail pages at `/conversations/[id]` render chronological email-style thread blocks with sender/recipient/timestamp metadata.
- Conversation detail pages cap initial message fetches and avoid running work-item sync on every page open; sync is driven by provider sync/new message paths and explicit actions.
- Reply composer supports manual send and AI draft generation. CC/BCC fields are present in the UI but are not yet forwarded by send APIs.
- Email HTML rendering uses sanitized iframe rendering with light-mode protection, safe links, safe schemes, and page-width containment. Remote images and other network loads are blocked by default; users can explicitly load HTTPS images for the displayed message without persisting that choice.
- Inbox previews use stored `Message.subject` plus cleaned body snippets through `buildPreviewText`.

### Gmail Writeback And Local State

- Opening a Gmail conversation marks it read locally and attempts Gmail unread-label removal.
- Gmail archive and trash writeback exist:
  - `archiveGmailThread` removes the Gmail `INBOX` label.
  - `trashGmailThread` moves the Gmail thread to Trash.
  - `PATCH /api/conversations/[id]/archive` and `/trash` are provider-gated to Gmail.
  - Archive/trash close the conversation locally, mark it read, and preserve existing `ConversationState.metadataJson`.
- Raw Gmail state (`gmailUnread`, `gmailRawState`, `gmailLabelIds`) is separate from local read/user state.
- User overrides survive sync and AI classification.
- Gmail mark-read writeback retries transient failures, queues failed mark-read writes in `GmailWritebackQueue`, and can be retried by `GET /api/cron/gmail-writeback`.
- `GET /api/cron/gmail-state-reconcile` detects recent local-read/Gmail-unread drift, logs `conversation_state.drift_detected`, queues mark-read writeback for explicit user reads, and auto-reconciles non-user local reads back to Gmail unread state.
- Failed Gmail push events are persisted in `GmailPushEvent` and can be retried by `GET /api/cron/gmail-push-retry`.

### Classification And Attention

- Conversation statuses: `needs_reply`, `in_progress`, `closed`.
- Attention categories live in `ConversationState.metadataJson.attentionCategory`:
  - `needs_reply`
  - `needs_action`
  - `review_soon`
  - `read_later`
  - `waiting_on`
  - `fyi_done`
  - `quiet`
- Deterministic email-type classification handles notification, newsletter, marketing, FYI, OTP/security, billing, delivery, calendar, account setup, verification, and password-reset patterns.
- Expired OTP/reset/login/security actions are removed from current Needs Action/Bills sections using explicit expiry text and conservative defaults.
- Manual attention correction is persisted through `PATCH /api/conversations/[id]/attention`, writes audit logs, updates conversation state, and marks metadata as user-corrected.

### Preference Learning

- Manual attention corrections are logged in `ClassificationCorrection`.
- After repeated corrections from the same sender or domain, FlowDesk creates a suggested `SenderRule`.
- `/settings` shows suggested and active attention rules.
- Users can apply, dismiss, or disable rules through `PATCH /api/sender-rules/[id]`.
- Active sender/domain rules apply during `syncConversationWorkItems`.
- Explicit user corrections always beat learned rules and AI classification.

### AI, Drafts, And Safety

- AI draft suggestions use OpenAI with approval-gated sending.
- Draft context is summarized and selected rather than sending large raw thread/KB blocks.
- Knowledge-base-backed drafts support citations from imported documents/webpages.
- Reply learning can use DB outbound samples and Gmail SENT samples.
- Cost-aware policy skips or caches richer AI work when deterministic handling is enough.
- AI budget guardrails track estimated cost per successful usage event, enforce tenant daily/monthly limits before rich AI calls, and record blocked attempts without counting them as spend.
- Budget-gated AI paths include draft generation, thread explanation, lead scoring, agent classification, autopilot draft generation, meeting prep/follow-up, reply-learning profile training, and LLM relationship-memory extraction.
- Sensitive/risky categories include legal, immigration, tax, medical, HR, emotional, financial/dispute, security, and angry-customer signals.
- Audit logs record key agent, human, and send actions. Some actions have undo support, especially autopilot draft approval.

### Command Center, Tasks, Leads, And Reports

- Daily command center surfaces reply/action/review/waiting/read-later/quietly-handled work.
- Tasks support extraction, manual creation, due-date editing, close actions, and conversation-page display.
- Leads support scoring, score explanations, estimated value, pipeline stage, filters, and on-demand re-score.
- Follow-up tracker and three-step lead follow-up sequences exist.
- Sales and support modes classify relevant business signals and surface panels/filters.
- Reports include weekly value reporting, ROI analytics, value snapshots, pipeline value, and revenue-at-risk views.
- Risk Radar exists as a deterministic read-only scan.
- Meeting prep and post-meeting follow-up flows exist for business/calendar use cases.

### Automations And Integrations (Phase 4)

- Plain-English rule creation via `AgentRule` model and NL compiler; preview shows affected emails and conflicts.
- Category-scoped autopilot policies (auto-send / require approval / never) per attention category.
- `Snippet` model with weekly miner, settings panel, and reply composer picker.
- `/clean-inbox` page with batch archive, batch unsubscribe, read-state updates, persisted user/state metadata, cache invalidation, and 1-hour undo that restores prior statuses.
- `SchedulingSession` model; scheduling requests detected during sync; Calendar-backed slot proposal.
- `AutomationRun` trace model; step executor (create_task, update_attention, archive); rollback within 24h.
- Automation step writes and rollback paths are tenant-guarded before mutating conversation, task, or conversation-state records.
- `WorkflowTemplate`/`WorkflowRun` models; 3 seeded default workflows; cron-driven step advancement.
- Google Drive OAuth connect/disconnect; `searchDriveForContext` for draft context enrichment.

## Key Data Models

- `Conversation`, `Message`, `Contact`, `Channel`
- `ConversationState`
- `InboxTask`
- `Lead`
- `Draft`, `ApprovalRequest`, `AuditLog`
- `PersonMemory`
- `KnowledgeDocument`
- `ValueSnapshot`
- `ClassificationCorrection`, `SenderRule`
- `AutopilotSetting`, `FollowUpSetting`
- `GmailCredential`
- `GmailPushEvent`, `GmailWritebackQueue`
- `SchedulingSession`, `AutomationRun`, `WorkflowTemplate`, `WorkflowRun`
- `AgentRule`, `Snippet`, `GoogleDriveCredential`

## Known Gaps

- CC/BCC fields in the composer are not yet sent by backend APIs.
- Command-center state is still mostly computed rather than snapshotted for history/explainability.
- Command-center auto-email heuristics still overlap with the shared inbox FYI helper and should be fully unified.
- Sender/domain rules cannot yet be manually created or edited beyond apply/dismiss/disable.
- Outlook has sync support but not equivalent archive/trash provider writeback.
- Inline Gmail `cid:` images are not resolved from attachment parts.
- Knowledge-base matching is keyword-oriented, not semantic/embedding based.
- Lead sequence timing is fixed; no settings UI yet.
- Risk Radar thresholds are deterministic and not user-configurable.
- URL crawl is single-page only; no sitemap or scheduled re-crawl.
- Team inbox features are not implemented as product features.
- Paid plan enforcement is not implemented in code.
- Full scheduling back-and-forth: confirmation detection and event booking not yet wired.
- WorkflowTemplate builder UI (drag-and-drop or form) not yet implemented.
- AutomationRun trigger conditions not yet user-configurable (system defaults only).
- Google Drive context not yet injected into draft generation (lib exists, not wired).
- Notion, Slack, Calendly integrations not yet implemented.

## Verification Pointers

Common verification commands:

```bash
npm test
npx tsc --noEmit
npm run build
```

Recently relevant focused tests:

- `tests/preference-learning.test.ts`
- `tests/gmail-archive-trash.test.ts`
- `tests/work-item-sync.test.ts`
- `tests/email-body.test.ts`
- `tests/email-iframe.test.ts`
- `tests/email-privacy-ui.test.ts`
- `tests/gmail-sync.test.ts`
- `tests/gmail-sync-runner.test.ts`
- `tests/gmail-watch-cron.test.ts`
- `tests/gmail-read-writeback.test.ts`
- `tests/gmail-state-reconcile-cron.test.ts`

## Documentation Rules

- Update this file when code changes what FlowDesk can actually do.
- Keep this file factual and concise; do not turn it into a changelog.
- Put shipped implementation details and old plans in `docs/archive/`.
- Put future work in `TODO.md`.
- Put strategic sequencing and feature status in `MASTER_PRODUCT_PLAN.md`.
