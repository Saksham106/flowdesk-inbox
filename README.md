# FlowDesk

FlowDesk is a Gmail-native AI email operator for individuals and small businesses. It works inside the user's existing Gmail to label, prioritize, draft, follow up, and organize email automatically, while the FlowDesk web app acts as the agent control room for setup, preferences, approvals, audit history, and power-user review.

---

## Current Product Scope

- **Gmail-native operator layer** — keep Gmail as the primary daily workspace while FlowDesk projects agent state back into Gmail with readable labels and safe actions
- **Gmail and Outlook sync** — connect an email account and import email threads into FlowDesk for supervision, review, and automation context
- **Manual and automatic Gmail refresh controls** — the inbox shell exposes real Gmail sync with last-synced/error status, app-load sync, tab-return sync, and periodic sync while open
- **Idempotent Gmail sync with local overrides** — duplicate syncs are locked per account, Gmail read/unread is imported separately from local read/done state, and user actions win over AI classification
- **Gmail label/read/archive/trash writeback** — workflow labels, read, archive, and trash actions update Gmail where supported while preserving local override metadata
- **Agent control room** — review email threads with status, drafts, assistant context, settings, approvals, and audit history without replacing Gmail
- **Email-style thread view** — opened conversations read top-to-bottom like an email client, with sender/recipient/timestamp metadata and a reply composer below the thread
- **Daily Command Center** — see the conversations that actually matter today, plus what can be safely ignored
- **Richer attention classification** — distinguishes needs reply, needs action, review soon, read later, waiting on, FYI done, and quiet instead of treating all automated email as useless
- **Deterministic preference learning** — repeated manual attention corrections can create sender/domain rules that users apply, dismiss, disable, and inspect in Settings
- **Deterministic account-action detection** — OTPs, verification links, password setup/reset, login approvals, account setup, and security alerts surface as action metadata without rich AI work
- **Cost-aware AI usage** — deterministic rules handle low-value automated mail first; richer AI is skipped, deferred, or cached for drafts and relationship memory when it does not add user value
- **Handle This** — ask FlowDesk to draft the next step from a thread-level assistant panel
- **AI draft suggestions (human-approved)** — generate, edit, approve, and send replies through the email provider
- **Personal mode by default** — personal/work-email accounts use personal writing style and inbox classification without CRM or sales language
- **Business mode** — business accounts can use business profile, knowledge base, CRM labels, sales/support signals, lead scoring, and revenue reporting
- **Google Calendar support for business accounts** — connect Google Calendar for availability and calendar holds
- **Follow-up and autopilot foundations** — classify work, queue follow-up jobs, and gate automation behind policy
- **Audit logs** — record agent, human, and send actions for review

---

## Documentation

Start here:

- `docs/README.md` — documentation index
- `docs/CURRENT_STATE.md` — current implemented/partial/deferred state
- `docs/product-direction.md` — Gmail-native product direction and strategy
- `docs/MASTER_PRODUCT_PLAN.md` — concise product direction, roadmap, and priorities
- `docs/TODO.md` — actionable remaining work
- `docs/reference/` — curated design rationale for core subsystems

## Deferred: SMS

SMS is paused. The A2P 10DLC carrier-registration process added significant compliance overhead before a single message could be sent, making it impractical to validate the product with early customers. The product also proved harder to onboard when SMS was the primary channel.

Email is the active channel. SMS may return later only after customer demand justifies a fresh spec.

---

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS v4**
- **PostgreSQL + Prisma 5**
- **NextAuth** (credentials-based auth, JWT sessions)
- **Google APIs** — Gmail API (email read/reply/modify/labels) + Google Calendar API (availability + events)
- **OpenAI** — draft suggestions, thread explanations, lead scoring, meeting prep/follow-up, reply-learning profiles, and gated relationship-memory extraction
- **MindBody Public API v6** — optional connector foundation
- **Railway** — hosting + managed Postgres

---

## Local Setup

### Prerequisites

- Node.js 20+
- Docker Desktop (for local Postgres)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example and fill in values:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` — for the included Docker Compose database, use `postgresql://flowdesk:flowdesk@localhost:5433/flowdesk_inbox?schema=public`
- `NEXTAUTH_URL` — base URL of the app (e.g. `http://localhost:3000`)
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `ENCRYPTION_SECRET` — generate with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — see Google OAuth setup below
- `OPENAI_API_KEY` — required for AI draft suggestions, explanations, lead scoring, meeting prep/follow-up, reply-learning, inbox chat, agent-rule compilation, and gated relationship-memory extraction
- `OPENAI_MODEL` — defaults/recommended value: `gpt-5.4-mini`

### 3. Start Postgres

```bash
docker compose up -d
```

### 4. Apply migrations + seed

```bash
npm run db:deploy
npm run db:seed
```

If a migration is described as applying "when the database is next reachable," the migration file has been committed but Postgres was not available when deploy was attempted. Start or restore the database, verify `DATABASE_URL`, then run `npm run db:deploy`; otherwise app code may reference tables or columns that do not exist yet.

### 5. Start the app

```bash
npm run dev
```

Default login:
- Email: `owner@flowdesk-inbox.local`
- Password: `password123`

---

## Connectors

Connectors are configured per account from the **Settings** page (`/settings`). The database still uses `Tenant` as the isolation model internally; product-facing behavior is controlled by `Tenant.accountType` (`personal` or `business`).

### Gmail

1. Create a Google Cloud project at `console.cloud.google.com`
2. Enable the **Gmail API**
3. Create OAuth 2.0 credentials (Web application)
4. Add redirect URI: `http://localhost:3000/api/connectors/gmail/callback`
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
6. Go to `/settings` -> click **+ Connect** under Gmail

Optional real-time sync:
- Create a Pub/Sub topic and subscription that pushes to `/api/connectors/gmail/push?secret=<GMAIL_PUSH_SECRET>`.
- Set `GMAIL_PUSH_TOPIC` to the topic name and `GMAIL_PUSH_SECRET` to the same secret used in the push URL.
- Schedule `GET /api/cron/gmail-watch` daily with `Authorization: Bearer <CRON_SECRET>` so Gmail watches renew before their 7-day expiration.
- Schedule `GET /api/cron/gmail-push-retry`, `GET /api/cron/gmail-writeback`, and `GET /api/cron/gmail-state-reconcile` with the same bearer token to retry failed push syncs, retry Gmail label/read writebacks, and detect local/Gmail read-state drift.

Gmail cron monitoring:
- Treat non-2xx responses from `GET /api/cron/gmail-watch` as alerts. The endpoint returns `500` and `X-Gmail-Watch-Errors: <count>` when any channel renewal fails.
- With cron-job.org or a similar scheduler, configure the job to expect HTTP 200 and send failures to email, Slack, or a webhook.
- With Railway, forward logs to Datadog or a similar provider and alert on `gmail_watch.renewal_failed`, `Failed to renew watch`, or `X-Gmail-Watch-Errors` above zero.
- For PagerDuty, route those scheduler webhooks or log-drain alerts to the service that owns Gmail sync.

Inbox sync behavior:
- Gmail sync runs through the shared runner in `lib/gmail-sync.ts`; manual sync, OAuth initial sync, and Pub/Sub push notifications all use the same database-backed per-channel lock.
- The inbox Gmail sync control prevents duplicate client requests. When Gmail push/watch is healthy it only auto-syncs as a stale fallback; when push is not configured it silently uses 15-minute polling (no warning shown); when push was previously configured but the watch is expiring within 24 hours or has a renewal error, a warning banner appears. Manual **Sync** always remains available and updates the sync badge without forcing a full page refresh.
- Overlapping server requests return `202 { skipped: "sync_in_progress" }`.
- Gmail raw state (`gmailUnread`, `gmailRawState`, `gmailLabelIds`) is stored separately from local user/read state (`userState`, `readAt`, `isRead`). Sync imports Gmail read/unread, but user actions such as Mark Done and local reads are not overwritten by AI classification.
- Sync observability is stored on `GmailCredential.lastSyncMode`, `lastSyncStatus`, `lastSyncError`, `lastSyncedAt`, `watchExpiresAt`, `watchRenewalError`, `watchLastRenewalAttempt`, and `lastHistoryFallbackAt`.
- Workflow/status changes queue FlowDesk Gmail label projection through `GmailWritebackQueue`. The cron applies the current `FlowDesk/*` labels to the Gmail thread and removes stale FlowDesk labels from that same namespace.
- Opening or marking a Gmail conversation read updates local state immediately, retries Gmail `UNREAD` removal, and queues failed writeback for cron retry without blocking the UI.
- If Gmail push is configured, Pub/Sub notifications trigger incremental sync server-side; push events are persisted by Pub/Sub `messageId` for idempotency and retry.
- Inbox auto-refresh polls `GET /api/inbox/summary` once per minute for lightweight status data instead of calling `router.refresh()` on the whole page.
- Inbox search filters currently loaded rows immediately, then updates the URL/server search after a 1-second pause or Enter.

### Outlook

1. Register a web application in Microsoft Entra ID and add the delegated permissions `openid`, `email`, `profile`, `offline_access`, `User.Read`, `Mail.Read`, `Mail.ReadWrite`, and `Mail.Send`.
2. Add `{NEXTAUTH_URL}/api/connectors/outlook/callback` as a Web redirect URI.
3. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
4. In production, set `NEXTAUTH_URL` to the public HTTPS origin. Microsoft Graph sends validation and change notifications to `{NEXTAUTH_URL}/api/connectors/outlook/webhook`.
5. Schedule `GET /api/cron/outlook-sync` every five minutes with `Authorization: Bearer <CRON_SECRET>`.

Outlook uses one shared Microsoft Graph Inbox delta engine for initial, manual, webhook-triggered, and fallback sync. A database lease prevents overlapping work per credential. Delta pages are capped per invocation, the encrypted continuation cursor is saved after every page, and the worker resumes partial rounds. Creates and updates use idempotent provider-message upserts; Graph tombstones remove the corresponding local message and close an emptied conversation.

Webhook requests only validate and enqueue routing metadata in `OutlookSyncEvent`; they never perform Graph work inline. `clientState` is random and encrypted at rest. The bounded cron worker processes at most 25 notification events, 25 subscription renewals, and 25 stale-mailbox fallbacks per invocation. Missed notifications are covered by a 15-minute stale delta fallback. Failed or lease-busy notification work is durably rescheduled, and abandoned event claims become eligible again after five minutes.

Operational checks:

- Apply migrations before enabling the cron or webhook. Treat non-2xx cron responses and `X-Outlook-Sync-Errors` above zero as alerts.
- Confirm the production callback and webhook URLs are reachable over valid public HTTPS. Microsoft Graph cannot deliver notifications to localhost or plain HTTP; local development therefore uses manual/fallback delta sync and skips subscription creation.
- After connecting a production mailbox, confirm `OutlookCredential.subscriptionId`, `subscriptionExpiresAt`, `lastSyncStatus`, and `lastSyncedAt` populate; then send, update, and delete a test Inbox message and confirm the next cron run converges.
- Never log access tokens, refresh tokens, encrypted delta links, notification `clientState`, message bodies, or Graph continuation URLs.

### Google Calendar

Google Calendar is currently exposed for business accounts.

1. Same Google Cloud project as Gmail
2. Enable the **Google Calendar API**
3. Add redirect URI: `http://localhost:3000/api/connectors/google-calendar/callback`
4. Same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — no extra credentials needed
5. Go to `/settings` → click **+ Connect** under Google Calendar

> **Note:** While your Google app is in Testing mode, add users at APIs & Services → OAuth consent screen → Test users before they can connect.

### MindBody (optional)

MindBody is business-mode only.

1. Register at `developers.mindbodyonline.com` and create an app to get your source password (API key)
2. Set `MINDBODY_API_KEY` in `.env`
3. Go to `/settings` → click **+ Connect** under MindBody
4. Enter the med spa's **Site ID**, **staff username**, and **staff password**

Credentials are verified live against MindBody's API before being saved. Use Site ID `-99` with the sandbox credentials for testing.

---

## Agent Job Executor

- Schedule `GET /api/cron/agent-jobs` every five minutes with `Authorization: Bearer <CRON_SECRET>`. It drains pending `AgentJob`s (LLM classification, follow-up, and lead-sequence work enqueued by the follow-up and lead-sequence crons).
- Each invocation runs at most 25 jobs, interleaving tenants round-robin so one tenant's backlog cannot starve others. Jobs are claimed atomically (`pending` → `running`), so overlapping invocations never double-run a job.
- Pending jobs older than 7 days are bulk-marked failed with the error `stale_at_executor_launch` (at most 200 per run) instead of executed — acting on weeks-old email would do more harm than good.
- The response body is `{ processed, succeeded, failed, skippedStale }`. Treat non-2xx responses and `X-Agent-Jobs-Errors` above zero as alerts: the endpoint returns `500` with the failed-job count in that header when any job fails, matching the Gmail/Outlook cron conventions.
- Executing jobs does not loosen autopilot: sends still pass policy, budget, confidence and per-intent thresholds, the intent allow-list, the daily cap, and the failure limit, and stay off until autopilot is explicitly enabled.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `NEXTAUTH_URL` | Yes | Public base URL for the current deployment, e.g. your custom domain |
| `NEXTAUTH_SECRET` | Yes | Session secret — `openssl rand -base64 32` |
| `ENCRYPTION_SECRET` | Yes (prod) | AES-256 key for encrypting OAuth tokens — `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (Gmail + Calendar) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID` | For Outlook | Microsoft Entra application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | For Outlook | Microsoft Entra application client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI draft suggestions, explanations, lead scoring, meeting prep/follow-up, reply-learning, inbox chat, agent-rule compilation, and gated relationship memory |
| `OPENAI_MODEL` | Yes | OpenAI model used for AI features; defaults/recommended value: `gpt-5.4-mini` |
| `GMAIL_PUSH_TOPIC` | Optional | Google Pub/Sub topic name for Gmail watch notifications, e.g. `projects/<project>/topics/<topic>` |
| `GMAIL_PUSH_SECRET` | Optional | Shared secret for the Pub/Sub push endpoint at `/api/connectors/gmail/push?secret=...` |
| `CRON_SECRET` | Required for cron | Bearer token for scheduled endpoints, including Gmail, Outlook, and agent jobs. Cron routes reject requests when this is unset; never configure schedulers with `Bearer undefined`. |
| `MINDBODY_API_KEY` | Optional | MindBody source password from developer portal |
| `SEED_EMAIL` | No | Override default login email |
| `SEED_PASSWORD` | No | Override default login password |
| `SEED_TENANT_NAME` | No | Override default tenant name |

Seeded tenants default to the schema default account type unless changed by code or database update. Signup requires an explicit `accountType` of `personal` or `business`.

---

## Encryption Key Rotation

`POST /api/admin/rekey` re-encrypts stored connector credentials after rotating `ENCRYPTION_SECRET`.

1. Back up the production database.
2. Set `ENCRYPTION_SECRET_PREVIOUS` to the old key and `ENCRYPTION_SECRET` to the new key.
3. Deploy the app, sign in as the target tenant/admin, then call `POST /api/admin/rekey`.
4. Confirm the response has `errors: 0`, then unset `ENCRYPTION_SECRET_PREVIOUS` in production.

The rekey route covers Gmail, Google Calendar, Google Drive, Outlook access/refresh tokens, Outlook encrypted delta links and subscription client state, and MindBody credential fields. Monitor the response error count and app logs before removing the previous key.

---

## Production Deployment (Railway)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Add a **Postgres** plugin — Railway injects `DATABASE_URL` automatically
4. Under the service's **Variables** tab, add all required env vars (see table above)
5. Add your public app URL as an authorized redirect URI in Google Cloud Console for both Gmail and Calendar
6. Deploy — Railway runs `npm run build` on push and `prisma migrate deploy` on start automatically
7. Seed the database once after first deploy:
   ```bash
   npm run db:seed
   ```

Set `NEXTAUTH_URL` to the same public app URL users visit in production.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run db:migrate` | Create/update schema (dev only) |
| `npm run db:deploy` | Apply pending migrations (production-safe) |
| `npm run db:seed` | Seed tenant/account and user |
| `npm run db:studio` | Open Prisma Studio |
