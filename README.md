# FlowDesk Inbox

AI-powered communications inbox for med spas. Centralizes inbound SMS, email, and third-party integrations (MindBody, Google Calendar) into a single inbox so staff can manage client conversations, book appointments, and send replies — all in one place.

## What it does

- **Unified inbox** — all inbound messages (SMS, Gmail) appear in one place with status tracking (Needs Reply / In Progress / Closed)
- **SMS via Twilio** — receive and reply to texts from clients; missed calls trigger an automatic SMS
- **Gmail connector** — connect a Gmail account to read and reply to emails directly from the inbox
- **Google Calendar connector** — connect Google Calendar to read/write events and check availability (used by the AI layer)
- **MindBody connector** — connect a MindBody site to look up clients, view appointments, and book sessions
- **Contacts** — save clients with names, auto-created from inbound messages
- **Labels & status** — organize conversations with custom labels and status
- **Multi-tenant** — each business gets its own isolated data

## Tech stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS v4**
- **PostgreSQL + Prisma**
- **NextAuth** (credentials-based auth, JWT sessions)
- **Twilio** — SMS send/receive + voice call handling
- **Gmail API** (googleapis) — email read/reply
- **Google Calendar API** — event read/write/availability
- **MindBody Public API v6** — client + appointment management
- **Railway** — hosting + managed Postgres

---

## Local setup

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

Required variables (see full list below):
- `NEXTAUTH_SECRET`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` *(for Gmail + Calendar connectors)*
- `MINDBODY_API_KEY` *(for MindBody connector)*

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

### MindBody

1. Register at `developers.mindbodyonline.com` and create an app to get your source password (API key)
2. Set `MINDBODY_API_KEY` in `.env`
3. Go to `/settings` → click **+ Connect** under MindBody
4. Enter the med spa's **Site ID**, **staff username**, and **staff password**

Credentials are verified live against MindBody's API before being saved. Use Site ID `-99` with the sandbox credentials for testing.

---

## Twilio setup (SMS + voice)

### Inbound SMS webhook (local dev)

1. Start ngrok: `ngrok http 3000`
2. Set your Twilio number's inbound webhook to:
   ```
   POST https://<ngrok-subdomain>.ngrok-free.app/api/webhooks/twilio/inbound
   ```

### Missed call auto-text (voice)

When a call goes unanswered, Twilio sends an automatic SMS to the caller. Configure the voice webhook on your Twilio number:
```
POST https://<your-domain>/api/webhooks/twilio/voice
```

Set `PUBLIC_WEBHOOK_BASE_URL` and `OFFICE_PHONE_NUMBER` in `.env`.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `NEXTAUTH_URL` | Yes | Base URL (e.g. `https://yourapp.up.railway.app`) |
| `NEXTAUTH_SECRET` | Yes | Session secret — `openssl rand -base64 32` |
| `ENCRYPTION_SECRET` | Yes (prod) | AES-256 key for encrypting tokens — `openssl rand -base64 32` |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio number in E.164 format |
| `PUBLIC_WEBHOOK_BASE_URL` | Yes | Public URL for Twilio voice callbacks |
| `OFFICE_PHONE_NUMBER` | Yes | Real office phone to ring before auto-texting |
| `MISSED_CALL_REPLY_TEXT` | No | Custom SMS for missed calls |
| `GOOGLE_CLIENT_ID` | Gmail/Calendar | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Gmail/Calendar | Google OAuth client secret |
| `MINDBODY_API_KEY` | MindBody | MindBody source password from developer portal |
| `SEED_EMAIL` | No | Override default login email |
| `SEED_PASSWORD` | No | Override default login password |
| `SEED_TENANT_NAME` | No | Override default tenant name |

---

## Production deployment (Railway)

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
8. Update Twilio webhook URLs to your Railway domain

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
