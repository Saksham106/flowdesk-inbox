# Current State

Last updated: 2026-07-06 (Phase D foundation: trust ladder + unified approvals)

FlowDesk is a Gmail-native AI email operator for individuals and small businesses. Gmail is the primary daily workspace; the FlowDesk web app is the agent control room for setup, preferences, approvals, audit history, training, and power-user review.

## Implemented

### Platform

- NextAuth credentials authentication with tenant-scoped data isolation.
- Personal and business account modes via `Tenant.accountType`. Personal accounts suppress all CRM, sales, lead-scoring, and business-framing AI behavior at the prompt and sync layers.
- Audit logs, approval requests, automation run traces, and undo for selected reversible actions.
- Unified approvals: `ApprovalRequest` is the single approval primitive (`step: "send"`, source in `metadataJson`). Every draft that reaches `proposed` (suggest, manual edit, meeting follow-up) gets one pending request; approve/send/clear/autopilot-send resolve it (`lib/agent/approvals.ts`), and `/approvals` decisions project back onto `Draft.status` — approve marks the draft approved, reject clears it and withdraws any Gmail-native draft. Cleared drafts cancel their request (`cancelled` status).

### Automation trust ladder

A per-tenant automation level (`AutopilotSetting.automationLevel`, 0–5) is the user-facing ceiling on what the agent may do on its own. It is mapped onto the existing gates (`lib/agent/automation-level.ts`) and never loosens them — an automated action runs only when the level allows it AND every pre-existing confidence/policy/budget/cap gate passes. User-initiated actions are never level-gated.

| Level | Meaning | Gmail labels | Gmail drafts | Auto mark-read/archive | Auto-send |
|-------|---------|--------------|--------------|------------------------|-----------|
| 0 | Read-only insights | no | no | no | no |
| 1 | Suggest in dashboard only | no | no | no | no |
| 2 | Apply labels in Gmail (new-tenant default) | yes | no | no | no |
| 3 | Create Gmail drafts | yes | yes | no | no |
| 4 | Mark low-risk read / archive safe categories | yes | yes | yes | no |
| 5 | Auto-send approved categories | yes | yes | yes | yes* |

*Auto-send requires Level 5 **and** autopilot enabled **and** all existing gates (learned profile, risk, confidence + per-category thresholds, allow-list, budget, daily cap, failure auto-disable). Levels ≤ 4 can never auto-send; the gate fails closed on a missing level. No automatic mark-read/archive path exists yet — the Level 4 gate is defined for future callers. Level changes require an explicit confirm in settings, are audited (`automation_level.changed`), and take effect immediately. Existing tenants were migrated without increasing autonomy: autopilot-enabled → 5, everyone else → 3 (labels + Gmail drafts were already unconditional); tenants without a settings row derive Level 3.

### Gmail

- OAuth connect/callback with encrypted token storage. Access token is auto-refreshed by the googleapis client; the `"tokens"` event handler persists refreshed tokens back to the DB.
- Expired or revoked credentials (`invalid_grant`) set `lastSyncStatus: "needs_reauth"`, surface a "Reconnect Gmail" CTA in both the inbox control and settings, and stop all automatic polling until reconnected.
- Incremental history sync via the Gmail History API with `labelId: INBOX` filter. Falls back to a recent-message scan when the history cursor is stale (cursor resets are timestamped in `lastHistoryFallbackAt` for UI visibility).
- Pub/Sub push notifications via renewable watches. Each notification is persisted in `GmailPushEvent` with idempotency on the Pub/Sub message ID; duplicate deliveries are no-ops.
- Per-channel sync lock via `updateMany` on `syncLockExpiresAt`. Parallel sync attempts skip and return 202 without duplicating work. Lock owner is implicit (row-level); lock expires after 2 minutes.
- Local read/archive/trash/unsubscribe writeback to Gmail. Failed mark-read writes queue into `GmailWritebackQueue` and are retried by cron with exponential backoff.
- Gmail-native label projection runs on manual workflow/status changes and automatically after classification and draft creation (`projectFlowDeskLabelsForConversation` in `lib/agent/work-item-sync.ts`, skipped when the user has manually overridden state or the tenant's automation level is below 2). `lib/gmail-labels.ts` maps FlowDesk state to user-facing labels under the `FlowDesk/` namespace (`Needs Reply`, `Waiting On`, `Read Later`, `Handled`, `Autodrafted`, etc.), queues `apply_labels` jobs in `GmailWritebackQueue`, and records `gmail.labels.queued` audit entries.
- FlowDesk labels are bootstrapped in Gmail on OAuth connect and manual sync (`ensureFlowDeskLabels`); per-label enable/disable and rename settings persist in `GmailLabelMapping` via `/api/gmail-label-settings` and the settings page.
- Gmail-native drafts: proposed FlowDesk reply drafts are written to Gmail as real drafts through `create_draft` writeback jobs (`lib/gmail-drafts.ts`), at automation Level 3+ (below that the draft stays dashboard-only). Creation dedupes by deleting the prior Gmail draft, skips when the user already replied manually, and stores the provider draft ID in draft metadata; `withdraw_draft` jobs remove the Gmail draft when the conversation leaves Draft Ready and are never level-gated (cleanup keeps working after a tenant lowers their level).
- `GET /api/cron/gmail-writeback` processes `mark_read`, `apply_labels`, `create_draft`, and `withdraw_draft` jobs. Label jobs create missing Gmail labels, apply the current FlowDesk labels to the thread, remove stale labels from the FlowDesk namespace, and record `gmail.labels.applied`. Every job is claimed atomically (pending → processing via `updateMany`) so overlapping cron runs never double-process; failures retry with exponential backoff (`nextWritebackAttemptDate`) and fail out permanently after `GMAIL_WRITEBACK_MAX_ATTEMPTS`. An empty label set is a valid payload meaning "remove all FlowDesk labels" and is queued only for threads that were labeled before, so no-label transitions clean up stale labels without spamming untouched threads.
- **Waiting-on / follow-up lifecycle** (Phase C): outbound replies that plausibly expect a response (deterministic heuristic `outboundMessageExpectsReply` in `lib/agent/follow-up.ts` — no LLM, personal and business modes alike) move the conversation to Waiting On. FlowDesk sends transition directly in the send path; replies sent natively in Gmail are detected during history sync (`conversation.waiting_on_detected` audit). An inbound reply self-heals: back to Needs Reply, pending follow-up jobs cancelled, stale waiting-on attention cleared, labels re-projected (`conversation.waiting_on_cleared`). After a tenant-configurable delay (`FollowUpSetting.staleAfterDays`, business days, default 3) the follow-up cron's label sweep (`runFollowUpLabelSweep`) adds `FlowDesk/Follow Up` (`follow_up.due_labeled`); the sweep runs for every tenant, while `FollowUpSetting.enabled` continues to gate only the automated follow-up job pipeline. No auto-sent follow-ups — labels and dashboard surfacing only.
- Gmail cron routes reject bearer-token auth when `CRON_SECRET` is unset, preventing accidental `Authorization: Bearer undefined` access in misconfigured deployments.
- Local user intent (read state, conversation status, attention category) is stored separately from raw Gmail state (`gmailUnread`, `gmailLabelIds`, `gmailRawState`) so provider syncs cannot overwrite explicit user choices.
- `GmailStateReconcile` cron detects local-read/Gmail-unread drift; auto-reconciles non-user reads and queues writeback for user-initiated reads.

### Outlook

- OAuth connect/callback with encrypted token and cursor storage.
- Leased incremental delta sync via Microsoft Graph `/me/mailFolders('inbox')/messages/delta`. The encrypted `deltaLinkEncrypted` cursor is persisted after each page so bounded cron runs can continue large initial imports across invocations without restarting.
- Lease uses a random owner ID (`syncLeaseId`); the completion update requires the same ID so a stale worker cannot release a newer worker's lock. HTTP 410 / invalid-cursor clears the saved cursor and schedules a fresh start.
- Webhook endpoint queues authenticated `OutlookSyncEvent` hints only (constant-time client-state comparison; message content and tokens are never stored). Graph delta sync happens in cron, not inline with the webhook response.
- Bounded cron: at most 25 queued events, 25 fallback credentials, and 25 subscription renewals per run.
- Admin rekey covers Outlook access/refresh tokens plus encrypted delta links and subscription client state, so key rotation does not strand incremental sync metadata.
- Outlook does not yet have archive/trash writeback.

### Email rendering

- Gmail MIME tree walker collects `text/html` and `text/plain` parts at up to 12 levels of nesting. HTML is preferred for rendering; plain text is used for AI prompts and snippet generation.
- HTML is sanitized with a strict allow-list and rendered in a sandboxed iframe. Remote images and other external network fetches are blocked by default. Users can explicitly load HTTPS images per message; the choice is not persisted (privacy-preserving by design).
- A forced light-mode color scheme prevents dark-mode email templates from rendering black in the iframe.
- Plain-text bodies are auto-linked. Gmail `cid:` inline images are resolved from MIME attachments into size-capped safe `data:` URIs at sync time (`resolveInlineCids` in `lib/google.ts`); messages synced before that fix keep unresolved `cid:` references.

### Inbox intelligence

- **Command center** (`lib/agent/command-center.ts`): pure analysis module — accepts pre-fetched plain objects, never calls Prisma directly. Pages own data fetching. This boundary keeps the analyzer independently unit-testable and lets page data shapes evolve without touching the scoring logic.
- **Email classifier** (`lib/agent/email-classifier.ts`): fully deterministic, no DB or AI calls. Evaluates no-reply sender addresses, known notification domains (GitHub, Google Docs, Jira, Linear, Supabase, etc.), subject patterns, and body patterns (unsubscribe links, marketing language) in priority order. Result stored in `ConversationState.metadataJson.emailType`; no schema migration needed.
- **Account-mode separation**: personal accounts receive a different classify prompt with no sales/lead/business framing. Lead scoring (`scoreLeadForConversation`) and sales signal classification are skipped entirely for personal accounts.
- **Reply-style learning**: reads FlowDesk outbound DB rows first; falls back to `fetchGmailSentSamples` (Gmail SENT label) when DB sample count < 5. Source counts stored in `sourceStatsJson` for transparency in the settings UI.
- **User-facing workflow status** (`Conversation.userState`): five clean states — Needs Reply, Draft Ready, Waiting On, Read Later, Done. `userState` is the canonical user choice; when null, `deriveWorkflowStatus()` computes it from DB status + AI attention category + draft state. AI signals (`attentionCategory`, `emailType`) remain in `ConversationState` as secondary read-only context, not primary user controls.
- **Reply workflow transitions**: AI draft generation/editing resets the conversation to Draft Ready inputs (`status: needs_reply`, `userState: null`) so proposed drafts win over stale Done/Waiting state. Successful sends create the outbound message, persist the conversation as Waiting On by default, clear the composer and saved draft text, and expose immediate Done / Waiting On next-step actions in the conversation composer.
- Manual corrections via `WorkflowStatusSelect` in the conversation right rail; learned sender/domain rules. Explicit user corrections always take precedence over learned rules and AI classification.
- Tasks, leads, follow-ups, risk radar, meeting prep/follow-up, weekly value reports, and revenue-at-risk reporting.
- AI drafts with knowledge-document citations, learned reply style, per-feature budget limits, metered AI usage, and human approval gates. Inbox chat and the agent-rule compiler both enforce budget checks and instantiate the OpenAI client at request/runtime boundaries, so missing keys return controlled errors instead of import-time crashes.
- Search, budget-metered inbox chat, person memory, attachment extraction, phishing warnings, VIPs, snooze, and Clean Inbox bulk actions.

### Control room dashboard

- The dashboard is the FlowDesk control room, not the intended daily workspace. It supervises Gmail-native behavior: review important threads, inspect agent reasoning, approve drafts/actions, tune settings, train the agent, and inspect audit history.
- Home view sections: Handle First (top-priority conversations with Draft Reply / Mark Done actions), Needs Action, Bills & Deadlines, Read Later, Waiting On (who you're waiting on, since when, and the follow-up due date from the tenant's configured delay), Agent Activity, and Quietly Handled banner. Mark Done uses the workflow-status endpoint, queues Gmail label projection for Google-backed threads, and done conversations are excluded from Handle First even when a fresh persisted AI state still says they need a reply.
- **Bills & Deadlines**: items sourced from `inboxTask` records with due dates ≤ 7 days out, plus conversations with `review_soon` attention. Per-item dismiss button: tasks close via `PATCH /api/tasks/:id/status`; billing alerts mark done via `PATCH /api/conversations/:id/workflow-status`.
- **Read Later**: per-card "Done" (with a 5-second undo that restores Read Later) and "Not interested" buttons, both persisted via `PATCH /api/conversations/:id/workflow-status`. Dismissals are optimistic; page refreshes on success.
- **Quietly Handled**: "Review all" links to `/inbox?status=closed` so users see the closed/quietly-handled conversations, not an unfiltered inbox.
- Stat pills (Handle First, Waiting On, Read Later, Quietly Handled) pull counts from the `DailyCommandCenter` built by `lib/agent/command-center.ts`. Handle First count equals `topActions.length` so it always matches the items shown.
- Support and Scheduling panel request loading states clear through `finally` blocks, so failed `fetch`/JSON parsing paths no longer leave buttons stuck in a loading state.

### Work items and classification persistence

- `lib/agent/work-items.ts` extracts task and lead candidates from conversation analysis. `lib/agent/work-item-sync.ts` persists them with tenant-scoped upserts and audit logs.
- Conversation-state persistence never overwrites records with source `"user_override"`; only deterministic-source state records are updated by sync. `InboxTask` field edits (e.g. a user-corrected due date) are **not** yet protected — the sync upsert overwrites `title`/`dueAt`/`source` on the same deterministic key (tracked in TODO).
- Fire-and-forget work-item sync calls catch and log async rejections, preventing background extraction failures from becoming unhandled promise rejections.
- `ConversationState.metadataJson` is a free-form JSON blob — all classification metadata (attention category, reason, confidence, email type, action code, expiry) lives here without dedicated schema columns. Existing rows without a field fall through to current default behavior.

### Automations and integrations

- Plain-English agent rules (`AgentRule` model, budget-metered NL compiler, conflict detection), category-scoped autopilot settings, snippets miner cron, scheduling sessions, automation run traces with rollback, and cron-driven workflow templates.
- `GET /api/cron/agent-jobs` executes pending `AgentJob`s (LLM classification, follow-up, lead-sequence) through `runAgentJob`: at most 25 jobs per run with per-tenant round-robin fairness, atomic pending → running claims so overlapping runs never double-execute, and per-job failure isolation. Pending jobs older than 7 days are bulk-failed as `stale_at_executor_launch` (200/run) rather than executed. Autopilot sends stay gated behind opt-in, learned profile, policy, budget, confidence/per-intent thresholds, daily cap, and failure limit — executing jobs does not enable sending. Auto-send additionally requires automation Level 5 (trust ladder above).
- Snooze persists a valid pre-snooze priority, marks snoozed conversations as `none`, and restores the saved priority on resurface with a medium fallback for legacy values.
- Google Calendar (events, free/busy, calendar holds), Google Drive OAuth foundation (not yet injected into drafts), and optional MindBody connector.

### Landing page

- Full visual redesign: white/light theme replacing dark/indigo. Sections: Nav, Hero, SocialProof, Features, HowItWorks (Outcomes grid), Pricing (Free/Pro/Enterprise), FAQ, FinalCTA, Footer.
- All static assets (hero bg, product screenshot, logo, CTA bg, outcome icon bg) committed to `public/images/landing/`.
- Lora serif font added via `next/font/google` for the CTA heading; Geist Sans + Geist Mono replace Space Grotesk + DM Mono app-wide.
- Enterprise "Contact sales" CTA routes to `mailto:admin@flowdeskinbox.com`.
- OG and Twitter card metadata added to `app/layout.tsx`.
- ScrollReveal and staggered animations are applied across landing sections; local committed images avoid expiring design-tool URLs. SocialProof section is text-only (no customer logos yet).

## Query and performance constraints

- Mobile inbox list is paginated at 50 conversations per page (offset + "Load more" link). The `?page=N` param preserves all active filters.
- Desktop sidebar (`AppListColumn`) fetches the top 50 conversations per filter view. The needs-reply badge count is a direct `prisma.conversation.count()` against deterministic `stateRecord` columns — body/sender regex heuristics are not applied to the count (badge may be slightly high for fully unclassified inboxes).
- Status counts (groupBy) are cached once per tenant per 60 s in their own `unstable_cache` entry (`["app-list-counts", tenantId]`) and shared across all filter views. `inbox/page.tsx` passes its already-fetched counts into `AppListColumn` to avoid a duplicate groupBy on desktop renders.
- Background jobs are bounded: `getStaleConversations` (`lib/agent/follow-up.ts`) processes at most 200 conversations per run; `close-fyi` admin route processes at most 100; the agent-jobs executor runs at most 25 jobs and stale-fails at most 200 per run.
- Home view (`commandCenterConversations`) is capped at `HOME_CONVERSATION_LIMIT = 25` conversations with `HOME_MESSAGE_LIMIT = 5` messages each.

## Important limitations

- Outlook does not yet have archive/trash writeback (Gmail equivalent exists).
- Scheduled label-maintenance re-bootstrap is unfinished. `Handle First` remains a dashboard ranking, not a Gmail label; it is intentionally excluded from the canonical `FlowDesk/*` Gmail label vocabulary to avoid unstable label churn.
- Gmail `cid:` inline images are only partially supported through size-capped embedding and still need broader safe rendering coverage.
- CC/BCC sending is not supported; the compose UI hides these fields until the send APIs support them.
- Bills & Deadlines items dismiss optimistically client-side but reappear on hard refresh until the server cache invalidates (60 s TTL).
- Read Later section shows a fixed 3-item preview; dismissed items vanish optimistically but the overflow count only updates after a page refresh.
- Classification heuristics still have edge-case overlap between command-center FYI logic and inbox list filtering.
- Sender/domain attention rules cannot be created or edited manually — only accepted from auto-generated suggestions.
- Knowledge-base matching is keyword-based; crawling is single-page only.
- Scheduling confirmation detection and calendar event booking are not yet wired end-to-end.
- Google Drive context is not yet injected into draft generation.
- Team inboxes, roles, paid-plan enforcement, and additional integrations are not implemented.

## Verification

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
