# FlowDesk Inbox

FlowDesk is an email-first AI inbox agent for individuals and small businesses. It turns email into an actionable command center: what needs a reply, what can be ignored, who needs follow-up, where money or deadlines are at risk, and which AI actions need approval before anything sends.

---

## Current Product Scope

- **Gmail and Outlook sync** — connect an email account and import conversations into FlowDesk
- **Google Calendar support** — connect Google Calendar for availability and calendar holds
- **Conversation inbox** — view conversations with status, labels, drafts, and assistant context
- **Daily Command Center** — see the conversations that actually matter today, plus what can be safely ignored
- **Handle This** — ask FlowDesk to draft the next step from a thread-level assistant panel
- **AI draft suggestions (human-approved)** — generate, edit, approve, and send replies through the email provider
- **Business profile + knowledge base** — store approved facts, policies, tone, and FAQs for better replies
- **Follow-up and autopilot foundations** — classify work, queue follow-up jobs, and gate automation behind policy
- **Audit logs** — record agent, human, and send actions for review

---

## Documentation

Start here:

- `docs/README.md` — documentation index
- `docs/CURRENT_STATE.md` — current implemented/partial/deferred state
- `docs/MASTER_PRODUCT_PLAN.md` — living master roadmap for the 45-feature product vision
- `docs/superpowers/specs/2026-06-11-daily-command-center-design.md` — Daily Command Center design
- `docs/superpowers/plans/2026-06-11-daily-command-center.md` — Daily Command Center implementation plan

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
- **OpenAI** — AI draft suggestions
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
- `OPENAI_API_KEY`
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

Connectors are configured per-tenant from the **Settings** page (`/settings`).

### Gmail

1. Create a Google Cloud project at `console.cloud.google.com`
2. Enable the **Gmail API**
3. Create OAuth 2.0 credentials (Web application)
4. Add redirect URI: `http://localhost:3000/api/connectors/gmail/callback`
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
6. Go to `/settings` → click **+ Connect** under Gmail

### Google Calendar

1. Same Google Cloud project as Gmail
2. Enable the **Google Calendar API**
3. Add redirect URI: `http://localhost:3000/api/connectors/google-calendar/callback`
4. Same `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — no extra credentials needed
5. Go to `/settings` → click **+ Connect** under Google Calendar

> **Note:** While your Google app is in Testing mode, add users at APIs & Services → OAuth consent screen → Test users before they can connect.

### MindBody (optional)

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
| `MINDBODY_API_KEY` | Optional | MindBody source password from developer portal |
| `SEED_EMAIL` | No | Override default login email |
| `SEED_PASSWORD` | No | Override default login password |
| `SEED_TENANT_NAME` | No | Override default tenant name |

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
| `npm run db:seed` | Seed tenant and user |
| `npm run db:studio` | Open Prisma Studio |
