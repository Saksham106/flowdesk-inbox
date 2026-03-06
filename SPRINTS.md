# FlowDesk Inbox — Sprint Plan

This document tracks sprint history and plans for reference during development.

---

## Product Vision

**FlowDesk Inbox** is a multi-tenant SaaS platform for managing customer conversations (SMS and, eventually, email) in a shared inbox.

**Stage 1 (current focus):** Reliable messaging infrastructure businesses can use immediately — missed-call auto-text, SMS inbox, multi-tenant support, Twilio integration.

**Stage 2 (future):** AI functionality — draft replies, conversation classification, suggested follow-ups, optional autopilot. Designed to plug into the existing conversation pipeline without major rearchitecturing.

**Priority order:** clean webhook handling → correct tenant routing → reliable message storage → simple inbox UX → AI.

---

## Sprint 1 — Close Stage 1 ✅

*Completed ~Feb 25, 2026*

- `try/catch` + meaningful errors in send route
- `MessageSid` deduplication via `@@unique([providerMessageId])`
- `AutoRefresh` polling (10s) on inbox and conversation views
- `.env.example` added

---

## Sprint 2 — Pilot-Ready ✅

*Completed ~Feb 28, 2026*

- Per-tenant Twilio credentials (`twilioAccountSid`, `twilioAuthTokenEncrypted`) on `Channel` model
- Inbound routing by `To` phone number → `Channel` → `Tenant`
- `Contact` model (name, phone, tenantId) — display names in inbox instead of raw numbers
- Seed from env vars (`TWILIO_PHONE_NUMBER`, `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_TENANT_NAME`)
- Railway deploy config (`railway.json`, `nixpacks.toml`) — production-ready

---

## Sprint 3 — Demo-able ✅

*Completed ~Mar 1, 2026*

- `ConversationStatus` enum: `needs_reply / in_progress / closed`
- `StatusButton` UI on conversation detail page
- Labels: `Lead / Reschedule / Pricing / Complaint` — `LabelSelect` UI
- `LabelBadge` and `StatusBadge` components in inbox list
- `Draft` and `DraftStatus` models scaffolded in schema (AI wiring deferred to Sprint 5)

**Remaining from original Sprint 3 plan:**
- Filters + search → moved to Sprint 4 (completed there)
- A2P 10DLC registration → out-of-band process, start in parallel

---

## Sprint 4 — Medspa MVP ✅

*Completed Mar 4, 2026*

**Goal:** Get medspas onto a working, reliable product before AI work begins.

### Track A — Missed-Call Auto-Text

- New schema fields on `Channel`: `officePhoneE164`, `missedCallReplyText`
- Migration: `20260304000000_sprint4_voice_channel`
- **Voice inbound webhook** (`POST /api/webhooks/twilio/voice`):
  - Validates Twilio signature using `PUBLIC_WEBHOOK_BASE_URL` (not `NEXTAUTH_URL`) — works in dev via ngrok and prod
  - Looks up `Channel` by `To` (Twilio number being called)
  - Forwards call to `officePhoneE164` via `<Dial action="/no-answer" timeout="20">` with 20s ring timeout
  - If no office phone configured: immediately sends auto-text and hangs up
- **No-answer action webhook** (`POST /api/webhooks/twilio/voice/no-answer`):
  - Fires when `DialCallStatus` is `no-answer`, `busy`, `failed`, or `canceled`
  - **Idempotency:** checks `AuditLog` for existing `missed_call_auto_text` row with matching `callSid` before sending — prevents duplicate texts on Twilio retries
  - Sends auto-SMS from Twilio number → caller's number using `channel.missedCallReplyText` or built-in default
  - Writes `AuditLog` row (`action: "missed_call_auto_text"`, payload includes `callSid`, `from`, `to`, `dialCallStatus`)
  - `DialCallStatus = completed` (call was answered) → no-op
- Seed updated to read `OFFICE_PHONE_NUMBER` and `MISSED_CALL_REPLY_TEXT` from env

### Track B — Inbox Filters + Search

- **Status tabs**: All · Needs Reply · In Progress · Closed — Next.js `<Link>` tabs with per-tab count badges
- **Search input** (`SearchInput.tsx` client component): debounced 300ms, updates `?q=` param preserving `?status=`
- Inbox page (`app/inbox/page.tsx`) refactored to accept `searchParams`:
  - `?status=needs_reply|in_progress|closed` filters by status
  - `?q=` searches `externalThreadId` and `contact.name` (case-insensitive)
  - Tab counts computed via `groupBy` — always reflect filtered result set

### Track C — Auth Token Encryption

- `lib/crypto.ts`: AES-256-GCM via `node:crypto`
  - `encryptString(plaintext)` → `iv:tag:ciphertext` (hex-encoded)
  - `decryptString(value)` → auto-detects encrypted vs plaintext (backwards-compatible)
  - `ENCRYPTION_SECRET` required in production, optional in dev (warns + passes through)
- `lib/twilio.ts` updated to call `decryptString()` on stored auth tokens
- `prisma/seed.ts` updated: encrypts auth token if `ENCRYPTION_SECRET` is set; warns + stores plaintext in dev
- `.env.example` updated with `ENCRYPTION_SECRET`, `PUBLIC_WEBHOOK_BASE_URL`, `OFFICE_PHONE_NUMBER`, `MISSED_CALL_REPLY_TEXT`

### Twilio Console Setup (required after deploy)

1. In Twilio Console → Phone Numbers → your number:
   - **A call comes in** → Webhook → `POST https://<your-domain>/api/webhooks/twilio/voice`
2. `PUBLIC_WEBHOOK_BASE_URL` env var must be set to the same base domain (used for the `<Dial action>` URL and signature validation)

---

## Sprint 5 — AI Drafts (Copilot) 🔜

*Planned — ~2 weeks*

- Wire up the `Draft` model already in the schema
- "Suggest reply" on inbound messages (OpenAI/Anthropic, grounded in per-tenant FAQ doc)
- Hard guardrails: no medical advice, escalate billing/complaints, always human approval
- Confidence flags — low-confidence drafts surfaced differently
- Human approval flow (`none → proposed → approved → sent`)

---

## Sprint 6 — Multi-Tenant Onboarding 🔜

*Planned — before Medspa #2*

- Twilio subaccount per tenant (master account → provisioned subaccount)
- Number purchase + assignment automated
- Self-serve signup flow
- Settings UI for tenants to configure channels and credentials

---

## Architecture Notes

- **Tenant isolation:** always enforced by `tenantId` on every query, derived from the Twilio `To` number on inbound events and from `session.user.tenantId` on API calls
- **Webhook signature validation:** all Twilio webhooks validate `X-Twilio-Signature` using the channel's per-tenant auth token (falls back to env)
- **Encryption:** auth tokens stored as AES-256-GCM ciphertext; format is `iv:tag:ciphertext` in hex; plaintext values pass through unchanged for backwards compatibility
- **Idempotency:** SMS messages deduplicated by `providerMessageId`; missed-call events deduplicated by `callSid` in `AuditLog`
- **AI pipeline:** `Draft` model with `DraftStatus` (`none → proposed → approved → sent`) is the extension point for Stage 2 AI — no structural changes needed to add AI drafts
