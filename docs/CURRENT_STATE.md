# Current State

Last updated: 2026-06-24

FlowDesk is an email-first AI inbox assistant for individuals and small businesses. It prioritizes important messages, extracts work, drafts responses, and keeps risky actions approval-gated.

## Implemented

### Platform

- NextAuth credentials authentication with tenant-scoped data.
- Personal and business account modes via `Tenant.accountType`.
- Audit logs, approval requests, automation traces, and undo for selected reversible actions.

### Email connectors

- Gmail OAuth, incremental history sync, Pub/Sub notifications, renewable watches, durable retries, state reconciliation, and per-channel locks.
- Gmail read, archive, trash, and unsubscribe writeback. Local user intent is stored separately from raw Gmail state.
- Expired/revoked Gmail credentials surface a reconnect flow and stop automatic polling.
- Outlook OAuth plus leased Microsoft Graph Inbox delta sync shared by initial, manual, webhook, and fallback runs.
- Outlook stores encrypted cursors and webhook client state, renews subscriptions, queues notification hints durably, and processes bounded fallback cron work.
- Email HTML is sanitized and sandboxed. Remote images are blocked by default and may be explicitly loaded per message.

### Inbox intelligence

- Command center, attention categories, deterministic email-type classification, sensitive-content detection, and manual corrections.
- Learned sender/domain rules from repeated corrections; explicit user choices override rules and AI.
- Tasks, leads, follow-ups, risk radar, meeting prep/follow-up, weekly value reports, and revenue-at-risk reporting.
- AI drafts with knowledge-document citations, learned reply style, budget limits, and human approval gates.
- Search, inbox chat, person memory, attachment extraction, phishing warnings, VIPs, snooze, and Clean Inbox bulk actions.

### Automations and integrations

- Plain-English agent rules, category-scoped autopilot settings, snippets, scheduling sessions, automation rollback, and cron-driven workflow templates.
- Google Calendar, Google Drive, and optional MindBody connector foundations.

## Important limitations

- Outlook does not yet have Gmail-equivalent archive/trash writeback.
- Gmail `cid:` images are not resolved from related MIME attachments.
- CC/BCC fields are displayed but not forwarded by send APIs.
- Classification heuristics still overlap between command-center and inbox filtering.
- Sender/domain rules cannot be created or edited manually.
- Knowledge-base matching is keyword-based; crawling is single-page.
- Scheduling confirmation/booking and the workflow builder UI are incomplete.
- Google Drive context is not yet injected into draft generation.
- Team inboxes, roles, paid-plan enforcement, and additional integrations are not implemented.

## Verification

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
