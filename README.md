# FlowDesk Inbox

FlowDesk is an email-first AI inbox agent for individuals and small businesses. It turns email into an actionable command center: what needs a reply, what can be ignored, who needs follow-up, where money or deadlines are at risk, and which AI actions need approval before anything sends.

---

## Current Product Scope

- **Gmail and Outlook sync** — connect an email account and import email threads into FlowDesk
- **Manual and automatic Gmail refresh controls** — the inbox shell exposes real Gmail sync with last-synced/error status, app-load sync, tab-return sync, and periodic sync while open
- **Idempotent Gmail sync with local overrides** — duplicate syncs are locked per account, Gmail read/unread is imported separately from local read/done state, and user actions win over AI classification
- **Gmail read/archive/trash writeback** — read, archive, and trash actions update Gmail where supported while preserving local override metadata
- **Conversation inbox** — view email threads with status, drafts, and assistant context
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
- `docs/MASTER_PRODUCT_PLAN.md` — living master roadmap for the 45-feature product vision
- `docs/archive/` — completed specs and implementation plans

## Deferred: SMS

SMS is paused. The A2P 10DLC carrier-registration process added significant compliance overhead before a single message could be sent, making it impractical to validate the product with early customers. The product also proved harder to onboard when SMS was the primary channel.

Email is the active channel. SMS may return later only after customer demand justifies a fresh spec.

---

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS v4**
- **PostgreSQL + Prisma 5**
- **NextAuth** (credentials-based auth, JWT sessions)
- **Google APIs** — Gmail API (email read/reply) + Google Calendar API (availability + events)
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
- `DATABASE_URL`
- `NEXTAUTH_URL` — base URL of the app (e.g. `http://localhost:3000`)
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `ENCRYPTION_SECRET` — generate with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — see Google OAuth setup below
- `OPENAI_API_KEY` — required for AI draft suggestions, explanations, lead scoring, meeting prep/follow-up, reply-learning, and gated relationship-memory extraction
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
- Schedule `GET /api/cron/gmail-push-retry`, `GET /api/cron/gmail-writeback`, and `GET /api/cron/gmail-state-reconcile` with the same bearer token to retry failed push syncs, retry Gmail writebacks, and detect local/Gmail read-state drift.

Inbox sync behavior:
- Gmail sync runs through the shared runner in `lib/gmail-sync.ts`; manual sync, OAuth initial sync, and Pub/Sub push notifications all use the same database-backed per-channel lock.
- The inbox Gmail sync control prevents duplicate client requests. When Gmail push/watch is healthy it only auto-syncs as a stale fallback; when push is not configured or the watch is unhealthy it keeps the 5-minute polling fallback. Manual **Sync** always remains available.
- Overlapping server requests return `202 { skipped: "sync_in_progress" }`.
- Gmail raw state (`gmailUnread`, `gmailRawState`, `gmailLabelIds`) is stored separately from local user/read state (`userState`, `readAt`, `isRead`). Sync imports Gmail read/unread, but user actions such as Mark Done and local reads are not overwritten by AI classification.
- Sync observability is stored on `GmailCredential.lastSyncMode`, `lastSyncStatus`, `lastSyncError`, `lastSyncedAt`, `watchExpiresAt`, `watchRenewalError`, `watchLastRenewalAttempt`, and `lastHistoryFallbackAt`.
- Opening or marking a Gmail conversation read updates local state immediately, retries Gmail `UNREAD` removal, and queues failed writeback for cron retry without blocking the UI.
- If Gmail push is configured, Pub/Sub notifications trigger incremental sync server-side; push events are persisted by Pub/Sub `messageId` for idempotency and retry.

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

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `NEXTAUTH_URL` | Yes | Public base URL for the current deployment, e.g. your custom domain |
| `NEXTAUTH_SECRET` | Yes | Session secret — `openssl rand -base64 32` |
| `ENCRYPTION_SECRET` | Yes (prod) | AES-256 key for encrypting OAuth tokens — `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (Gmail + Calendar) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI draft suggestions |
| `OPENAI_MODEL` | Yes | OpenAI model used for draft suggestions |
| `GMAIL_PUSH_TOPIC` | Optional | Google Pub/Sub topic name for Gmail watch notifications, e.g. `projects/<project>/topics/<topic>` |
| `GMAIL_PUSH_SECRET` | Optional | Shared secret for the Pub/Sub push endpoint at `/api/connectors/gmail/push?secret=...` |
| `CRON_SECRET` | Optional | Bearer token for scheduled endpoints, including Gmail watch renewal |
| `MINDBODY_API_KEY` | Optional | MindBody source password from developer portal |
| `SEED_EMAIL` | No | Override default login email |
| `SEED_PASSWORD` | No | Override default login password |
| `SEED_TENANT_NAME` | No | Override default tenant name |

Seeded tenants default to the schema default account type unless changed by code or database update. Signup requires an explicit `accountType` of `personal` or `business`.

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
