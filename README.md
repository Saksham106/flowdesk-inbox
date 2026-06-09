# FlowDesk Inbox

FlowDesk is an email-first AI front desk for appointment-heavy small businesses. It reads inbound Gmail, drafts safe replies, suggests appointment times from Google Calendar, and escalates sensitive conversations to staff — all with a full audit trail and human approval before anything sends.

---

## Current MVP Scope

- **Gmail OAuth connect/sync** — connect a business Gmail account; inbound emails appear in the conversation inbox automatically
- **Google Calendar connect** — connect Google Calendar to read availability and suggest appointment times
- **Conversation inbox** — all inbound emails in one place with status tracking (Needs Reply / In Progress / Closed)
- **Manual reply** — staff can read and reply to conversations directly from the inbox
- **AI draft suggestions (human-approved)** — the AI drafts a reply; a staff member reviews and approves before anything sends
- **Business profile + knowledge base** — store business hours, services, and FAQs so the AI has accurate context
- **Audit logs** — every AI suggestion, human edit, and send action is recorded for compliance and review

---

## Deferred: SMS / Twilio

Twilio and SMS are paused. The A2P 10DLC carrier-registration process added significant compliance overhead before a single message could be sent, making it impractical to validate the product with early customers. The product also proved harder to onboard when SMS was the primary channel — businesses wanted email first.

**Email is now the primary (and only) channel for the MVP.** SMS may return after the email-AI workflow closes pilots and customers actively request it.

---

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS v4**
- **PostgreSQL + Prisma 5**
- **NextAuth** (credentials-based auth, JWT sessions)
- **Google APIs** — Gmail API (email read/reply) + Google Calendar API (availability + events)
- **OpenAI** — AI draft suggestions
- **MindBody Public API v6** — client + appointment management (optional connector)
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

### 3. Start Postgres

```bash
docker compose up -d
```

### 4. Push schema + seed

```bash
npx prisma db push
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
| `NEXTAUTH_URL` | Yes | Base URL (e.g. `https://yourapp.up.railway.app`) |
| `NEXTAUTH_SECRET` | Yes | Session secret — `openssl rand -base64 32` |
| `ENCRYPTION_SECRET` | Yes (prod) | AES-256 key for encrypting OAuth tokens — `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (Gmail + Calendar) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI draft suggestions |
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
5. Add your Railway URL as an authorized redirect URI in Google Cloud Console for both Gmail and Calendar
6. Deploy — Railway runs `npm run build` on push and `prisma migrate deploy` on start automatically
7. Seed the database once after first deploy:
   ```bash
   npm run db:seed
   ```

Live URL: `https://flowdesk-inbox-production.up.railway.app`

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run db:migrate` | Create/update schema (dev only) |
| `npm run db:deploy` | Apply pending migrations (production-safe) |
| `npm run db:seed` | Seed tenant, user, and channel |
| `npm run db:studio` | Open Prisma Studio |
