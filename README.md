# flowdesk-inbox

Minimal multi-tenant SMS inbox (Twilio) for V1.

## Requirements

- Node.js 18+
- Docker Desktop

## Local setup

1) Install dependencies

```bash
npm install
```

2) Configure environment

```bash
cp .env.example .env
```

Fill in:
- `NEXTAUTH_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

3) Start Postgres

```bash
docker compose up -d
```

4) Run migrations + seed

```bash
npm run db:migrate
npm run db:seed
```

5) Start the app

```bash
npm run dev
```

Login:
- Email: `owner@flowdesk-inbox.local`
- Password: `password123`

## Twilio inbound webhook (local)

1) Start ngrok

```bash
ngrok http 3000
```

2) Configure your Twilio phone number webhook:

```
POST https://<ngrok-subdomain>.ngrok-free.app/api/webhooks/twilio/inbound
```

3) Send an SMS to your Twilio number. It will appear in `/inbox`.

### Sample curl (manual)

Twilio signs requests with `X-Twilio-Signature`. To simulate a webhook, compute the signature and send a form-encoded request:

```bash
node -e "const crypto=require('crypto');const url='https://<ngrok-subdomain>.ngrok-free.app/api/webhooks/twilio/inbound';const params={From:'+15555550123',To:'+15555550100',Body:'Hello',MessageSid:'SM123'};const data=url+Object.keys(params).sort().map(k=>k+params[k]).join('');const sig=crypto.createHmac('sha1',process.env.TWILIO_AUTH_TOKEN).update(data).digest('base64');console.log(sig);"
```

```bash
curl -X POST 'https://<ngrok-subdomain>.ngrok-free.app/api/webhooks/twilio/inbound' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'X-Twilio-Signature: <computed-signature>' \
  --data-urlencode 'From=+15555550123' \
  --data-urlencode 'To=+15555550100' \
  --data-urlencode 'Body=Hello from curl' \
  --data-urlencode 'MessageSid=SM123'
```

## Environment variables

- `DATABASE_URL`: Postgres connection string
- `NEXTAUTH_URL`: base URL (e.g. `https://yourdomain.up.railway.app`)
- `NEXTAUTH_SECRET`: session secret — generate with `openssl rand -base64 32`
- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token (used for signature validation and send)
- `TWILIO_PHONE_NUMBER`: your Twilio number in E.164 format (e.g. `+12125550100`) — **required for seeding**
- `SEED_EMAIL` *(optional)*: override the default login email
- `SEED_PASSWORD` *(optional)*: override the default login password
- `SEED_TENANT_NAME` *(optional)*: override the default tenant name

## Production deployment (Railway)

1. Push this repo to GitHub.

2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select this repo.

3. Add a **Postgres** plugin inside the Railway project. Railway will inject `DATABASE_URL` automatically.

4. Under the service's **Variables** tab, add:
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `NEXTAUTH_URL` — `https://<your-service>.up.railway.app`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`

5. Deploy. Railway runs `npm run build` on push and `prisma migrate deploy` on start automatically (see `railway.json`).

6. After first deploy, seed the database once:
   ```bash
   # From Railway's service shell, or locally with DATABASE_URL pointing at prod:
   npm run db:seed
   ```

7. Update your Twilio phone number's inbound webhook to:
   ```
   POST https://<your-service>.up.railway.app/api/webhooks/twilio/inbound
   ```

## Scripts

- `npm run dev`: start Next.js dev server
- `npm run build`: production build
- `npm run db:migrate`: create/update schema (dev only — prompts interactively)
- `npm run db:deploy`: apply pending migrations (production-safe, non-interactive)
- `npm run db:seed`: seed tenant/user/channel (requires `TWILIO_PHONE_NUMBER`)
- `npm run db:studio`: open Prisma Studio
