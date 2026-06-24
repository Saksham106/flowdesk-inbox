# Current State

Last updated: 2026-06-24 (landing-page-redesign + inbox query perf + dashboard UX fixes)

FlowDesk is an email-first AI inbox assistant for individuals and small businesses. It prioritizes important messages, extracts work, drafts responses, and keeps risky actions approval-gated.

## Implemented

### Platform

- NextAuth credentials authentication with tenant-scoped data isolation.
- Personal and business account modes via `Tenant.accountType`. Personal accounts suppress all CRM, sales, lead-scoring, and business-framing AI behavior at the prompt and sync layers.
- Audit logs, approval requests, automation run traces, and undo for selected reversible actions.

### Gmail

- OAuth connect/callback with encrypted token storage. Access token is auto-refreshed by the googleapis client; the `"tokens"` event handler persists refreshed tokens back to the DB.
- Expired or revoked credentials (`invalid_grant`) set `lastSyncStatus: "needs_reauth"`, surface a "Reconnect Gmail" CTA in both the inbox control and settings, and stop all automatic polling until reconnected.
- Incremental history sync via the Gmail History API with `labelId: INBOX` filter. Falls back to a recent-message scan when the history cursor is stale (cursor resets are timestamped in `lastHistoryFallbackAt` for UI visibility).
- Pub/Sub push notifications via renewable watches. Each notification is persisted in `GmailPushEvent` with idempotency on the Pub/Sub message ID; duplicate deliveries are no-ops.
- Per-channel sync lock via `updateMany` on `syncLockExpiresAt`. Parallel sync attempts skip and return 202 without duplicating work. Lock owner is implicit (row-level); lock expires after 2 minutes.
- Local read/archive/trash/unsubscribe writeback to Gmail. Failed mark-read writes queue into `GmailWritebackQueue` and are retried by cron with exponential backoff.
- Local user intent (read state, conversation status, attention category) is stored separately from raw Gmail state (`gmailUnread`, `gmailLabelIds`, `gmailRawState`) so provider syncs cannot overwrite explicit user choices.
- `GmailStateReconcile` cron detects local-read/Gmail-unread drift; auto-reconciles non-user reads and queues writeback for user-initiated reads.

### Outlook

- OAuth connect/callback with encrypted token and cursor storage.
- Leased incremental delta sync via Microsoft Graph `/me/mailFolders('inbox')/messages/delta`. The encrypted `deltaLinkEncrypted` cursor is persisted after each page so bounded cron runs can continue large initial imports across invocations without restarting.
- Lease uses a random owner ID (`syncLeaseId`); the completion update requires the same ID so a stale worker cannot release a newer worker's lock. HTTP 410 / invalid-cursor clears the saved cursor and schedules a fresh start.
- Webhook endpoint queues authenticated `OutlookSyncEvent` hints only (constant-time client-state comparison; message content and tokens are never stored). Graph delta sync happens in cron, not inline with the webhook response.
- Bounded cron: at most 25 queued events, 25 fallback credentials, and 25 subscription renewals per run.
- Outlook does not yet have archive/trash writeback.

### Email rendering

- Gmail MIME tree walker collects `text/html` and `text/plain` parts at up to 12 levels of nesting. HTML is preferred for rendering; plain text is used for AI prompts and snippet generation.
- HTML is sanitized with a strict allow-list and rendered in a sandboxed iframe. Remote images and other external network fetches are blocked by default. Users can explicitly load HTTPS images per message; the choice is not persisted (privacy-preserving by design).
- A forced light-mode color scheme prevents dark-mode email templates from rendering black in the iframe.
- Plain-text bodies are auto-linked; `cid:` inline images are not yet resolved from MIME attachments.

### Inbox intelligence

- **Command center** (`lib/agent/command-center.ts`): pure analysis module — accepts pre-fetched plain objects, never calls Prisma directly. Pages own data fetching. This boundary keeps the analyzer independently unit-testable and lets page data shapes evolve without touching the scoring logic.
- **Email classifier** (`lib/agent/email-classifier.ts`): fully deterministic, no DB or AI calls. Evaluates no-reply sender addresses, known notification domains (GitHub, Google Docs, Jira, Linear, Supabase, etc.), subject patterns, and body patterns (unsubscribe links, marketing language) in priority order. Result stored in `ConversationState.metadataJson.emailType`; no schema migration needed.
- **Account-mode separation**: personal accounts receive a different classify prompt with no sales/lead/business framing. Lead scoring (`scoreLeadForConversation`) and sales signal classification are skipped entirely for personal accounts.
- **Reply-style learning**: reads FlowDesk outbound DB rows first; falls back to `fetchGmailSentSamples` (Gmail SENT label) when DB sample count < 5. Source counts stored in `sourceStatsJson` for transparency in the settings UI.
- Attention categories (`needs_reply`, `needs_action`, `review_soon`, `read_later`, `waiting_on`, `fyi_done`, `quiet`), manual corrections, and learned sender/domain rules. Explicit user corrections always take precedence over learned rules and AI classification.
- Tasks, leads, follow-ups, risk radar, meeting prep/follow-up, weekly value reports, and revenue-at-risk reporting.
- AI drafts with knowledge-document citations, learned reply style, per-feature budget limits, and human approval gates.
- Search, inbox chat, person memory, attachment extraction, phishing warnings, VIPs, snooze, and Clean Inbox bulk actions.

### Dashboard (home command center)

- Home view sections: Handle First (top-priority conversations with Draft Reply / Mark Done actions), Needs Action, Bills & Deadlines, Read Later, Waiting On, Agent Activity, and Quietly Handled banner.
- **Bills & Deadlines**: items sourced from `inboxTask` records with due dates ≤ 7 days out, plus conversations with `review_soon` attention. Per-item dismiss button: tasks close via `PATCH /api/tasks/:id/status`; billing alerts reclassify to `fyi_done` via `PATCH /api/conversations/:id/attention`.
- **Read Later**: per-card ✓ (mark FYI/Done) and ✕ (mark Quiet) buttons, both persisted via `PATCH /api/conversations/:id/attention`. Dismissals are optimistic; page refreshes on success.
- **Quietly Handled**: "Review all" links to `/inbox?attention=fyi_done` so users see the actual quietly-handled emails, not an unfiltered inbox.
- Stat pills (Needs Reply, Needs Action, Waiting On, Read Later, Quietly Handled) pull counts from the `DailyCommandCenter` built by `lib/agent/command-center.ts`.

### Work items and classification persistence

- `lib/agent/work-items.ts` extracts task and lead candidates from conversation analysis. `lib/agent/work-item-sync.ts` persists them with tenant-scoped upserts and audit logs.
- Persistence never overwrites records with source `"user"`; only `"deterministic"` source records are updated by sync. This preserves explicit user edits across provider syncs.
- `ConversationState.metadataJson` is a free-form JSON blob — all classification metadata (attention category, reason, confidence, email type, action code, expiry) lives here without dedicated schema columns. Existing rows without a field fall through to current default behavior.

### Automations and integrations

- Plain-English agent rules (`AgentRule` model, NL compiler, conflict detection), category-scoped autopilot settings, snippets miner cron, scheduling sessions, automation run traces with rollback, and cron-driven workflow templates.
- Google Calendar (events, free/busy, calendar holds), Google Drive OAuth foundation (not yet injected into drafts), and optional MindBody connector.

### Landing page

- Full visual redesign: white/light theme replacing dark/indigo. Sections: Nav, Hero, SocialProof, Features, HowItWorks (Outcomes grid), Pricing (Free/Pro/Enterprise), FAQ, FinalCTA, Footer.
- All static assets (hero bg, product screenshot, logo, CTA bg, outcome icon bg) committed to `public/images/landing/`.
- Lora serif font added via `next/font/google` for the CTA heading; Geist Sans + Geist Mono replace Space Grotesk + DM Mono app-wide.
- Enterprise "Contact sales" CTA routes to `mailto:admin@flowdeskinbox.com`.
- OG and Twitter card metadata added to `app/layout.tsx`.
- SocialProof section is text-only (no customer logos yet).

## Query and performance constraints

- Mobile inbox list is paginated at 50 conversations per page (offset + "Load more" link). The `?page=N` param preserves all active filters.
- Desktop sidebar (`AppListColumn`) fetches the top 50 conversations per filter view. The needs-reply badge count is a direct `prisma.conversation.count()` against deterministic `stateRecord` columns — body/sender regex heuristics are not applied to the count (badge may be slightly high for fully unclassified inboxes).
- Status counts (groupBy) are cached once per tenant per 60 s in their own `unstable_cache` entry (`["app-list-counts", tenantId]`) and shared across all filter views. `inbox/page.tsx` passes its already-fetched counts into `AppListColumn` to avoid a duplicate groupBy on desktop renders.
- Background jobs are bounded: `getStaleConversations` (`lib/agent/follow-up.ts`) processes at most 200 conversations per run; `close-fyi` admin route processes at most 100.
- Home view (`commandCenterConversations`) is capped at `HOME_CONVERSATION_LIMIT = 25` conversations with `HOME_MESSAGE_LIMIT = 5` messages each.

## Important limitations

- Outlook does not yet have archive/trash writeback (Gmail equivalent exists).
- Gmail `cid:` inline images are not resolved from related MIME attachments.
- CC/BCC fields are displayed in the compose UI but not forwarded by send APIs.
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
