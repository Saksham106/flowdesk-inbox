# AI Draft MVP Handoff

Date: 2026-06-09

This handoff documents the AI Draft MVP work that was implemented in two stacked pull requests.

## PRs and Merge Order

Merge in this order:

1. Backend/API: https://github.com/Saksham106/flowdesk-inbox/pull/7
   - Branch: `ai-draft-mvp-backend`
   - Base: `main`
2. Frontend UI: https://github.com/Saksham106/flowdesk-inbox/pull/8
   - Branch: `ai-draft-mvp-frontend`
   - Base: `ai-draft-mvp-backend`

After PR #7 merges, retarget PR #8 to `main` if GitHub does not do it automatically.

## What Was Implemented

The MVP now supports staff-approved AI reply drafting for email conversations:

1. Staff opens an email conversation.
2. Staff clicks `Suggest reply`.
3. Backend loads conversation history, business profile, and knowledge base.
4. OpenAI generates structured draft output.
5. App stores a proposed `Draft` with AI metadata.
6. Staff reviews and edits the draft.
7. Staff clicks `Approve & Send`.
8. Backend sends through Gmail using the shared send helper.
9. App marks the draft as sent and writes audit logs.

The AI does not send automatically. Calendar booking is not included in this slice.

## Backend/API Changes

Important files:

- `lib/ai/provider.ts`
- `lib/ai/openai.ts`
- `lib/ai/prompts/draft-reply.ts`
- `lib/conversations/send-message.ts`
- `app/api/conversations/[id]/draft/suggest/route.ts`
- `app/api/conversations/[id]/draft/route.ts`
- `app/api/conversations/[id]/draft/send-approved/route.ts`
- `app/api/conversations/[id]/send/route.ts`
- `prisma/migrations/20260609000000_ai_draft_metadata/migration.sql`
- `tests/ai-draft-provider.test.ts`
- `tests/ai-draft-routes.test.ts`

New API routes:

- `POST /api/conversations/[id]/draft/suggest`
  - Email-only.
  - Requires an authenticated tenant session.
  - Requires a business profile.
  - Loads business context and generates an OpenAI draft.
  - Upserts `Draft` with `status = proposed`.
  - Stores metadata in `Draft.metadataJson`.
  - Optionally applies a suggested label.
  - Writes `draft.suggest` audit log.

- `PATCH /api/conversations/[id]/draft`
  - Saves staff edits with `{ text }`.
  - Approves with `{ status: "approved" }`.
  - Clears with `{ status: "none" }`.
  - Writes `draft.edit`, `draft.approve`, or `draft.clear` audit logs.

- `POST /api/conversations/[id]/draft/send-approved`
  - Email-only.
  - Sends an existing proposed or approved draft.
  - Marks proposed drafts approved before sending.
  - Uses `sendConversationMessage`.
  - Marks draft `sent`.
  - Writes `draft.approve`, `conversation.send`, and `draft.sent` audit logs.

Existing manual send behavior was refactored:

- `app/api/conversations/[id]/send/route.ts` now delegates to `lib/conversations/send-message.ts`.
- Gmail and Twilio manual sends still share the same database write and audit behavior as before.
- The AI-approved send path uses the same helper, so there is one source of truth for sending.

## AI Provider

The provider is OpenAI direct for this MVP.

Environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

`.env.example` now recommends:

```env
OPENAI_MODEL="gpt-5.4-mini"
```

If that model is not available on the account, change `OPENAI_MODEL` in `.env` without code changes.

The prompt output schema includes:

- `draftText`
- `intent`
- `confidence`
- `riskLevel`
- `suggestedLabel`
- `escalationReason`

Guardrails in the prompt:

- Do not diagnose.
- Do not give medical advice.
- Do not promise outcomes.
- Do not claim calendar availability.
- Escalate complaints, emergencies, refunds, legal/medical issues, or sensitive topics.
- Ask concise clarifying questions when information is missing.

## Database Changes

`Draft` was extended:

```prisma
model Draft {
  id             String      @id @default(cuid())
  conversationId String      @unique
  text           String
  status         DraftStatus @default(none)
  metadataJson   Json?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  conversation   Conversation @relation(fields: [conversationId], references: [id])
}
```

Migration:

```bash
npm run db:deploy
```

This was applied locally after implementation.

## Frontend Changes

Important files:

- `app/conversations/[id]/page.tsx`
- `app/conversations/[id]/AIDraftPanel.tsx`

The conversation page now loads:

- `conversation.draft`
- whether a `BusinessProfile` exists
- `KnowledgeDocument` count

The AI draft panel:

- Appears above the manual `Send reply` card.
- Enables `Suggest reply` only for email conversations with a business profile.
- Shows a warning when knowledge base count is zero, but still allows generation.
- Shows metadata: intent, confidence, risk, suggested label, escalation reason.
- Allows editing draft text.
- Has explicit buttons:
  - `Suggest reply`
  - `Save edits`
  - `Clear`
  - `Approve & Send`

There is no auto-send path in the UI.

## Verification Already Run

These passed on the backend branch and on the final stacked frontend branch:

```bash
npm test
npm run lint
npx prisma validate
npm run build
```

Final test count:

```text
37 tests passed
```

Migration was also applied locally:

```bash
npm run db:deploy
```

Note: running `npm run db:deploy` inside the sandbox initially produced a bare Prisma schema engine error. Running it with normal local permissions succeeded. The database and migration SQL were both valid.

## Local Run Checklist

After pulling the merged PRs:

```bash
npm install
docker compose up -d
npm run db:deploy
npm run db:seed
npm run dev
```

Required `.env` values for this MVP:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `ENCRYPTION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Then:

1. Log in.
2. Go to `/settings`.
3. Connect Gmail.
4. Add or confirm a Business Profile.
5. Add at least one Knowledge Document for better replies.
6. Sync Gmail.
7. Open an email conversation.
8. Click `Suggest reply`.
9. Edit if needed.
10. Click `Approve & Send`.

## Known Limitations

- Email-only for AI drafts.
- No automatic draft generation on sync.
- No AgentJob, AgentToolCall, or ApprovalRequest tables yet.
- No calendar availability in draft generation yet.
- No vector search or embeddings; knowledge context uses the existing tenant-scoped document lookup.
- No AI usage tracking or rate limiting yet.
- No dedicated audit log viewer yet.
- `Contact.phoneE164` still stores email-like values in some Gmail flows because the original schema was SMS-first.

## Recommended Next Work

Highest-value follow-ups:

1. Merge PR #7, then PR #8.
2. Manually QA the Gmail AI draft flow with a real test Gmail thread.
3. Add better error messages in the UI by surfacing API response bodies instead of generic fallback text.
4. Add AI usage/rate limiting per tenant before pilots.
5. Add a simple audit log view for conversation-level AI actions.
6. Add calendar-aware scheduling suggestions:
   - detect scheduling intent,
   - call Google Calendar free/busy,
   - draft 2-3 possible slots,
   - still require human approval.
7. Decide whether to introduce `AgentJob` now or wait until automatic-on-sync draft generation is needed.

## Suggested Manual QA Script

Use this before calling the MVP demo-ready:

1. Create a seeded/local tenant.
2. Add Business Profile:
   - business name,
   - timezone,
   - default tone,
   - booking policy,
   - escalation policy.
3. Add Knowledge Documents:
   - pricing FAQ,
   - services FAQ,
   - cancellation policy.
4. Connect Gmail.
5. Send a test inbound email asking a pricing question.
6. Sync Gmail.
7. Open the conversation.
8. Confirm `Suggest reply` is enabled.
9. Generate draft.
10. Confirm metadata is visible.
11. Edit text and save.
12. Approve and send.
13. Confirm outbound email appears in Gmail.
14. Confirm outbound `Message` was created in the app.
15. Confirm draft status is `sent`.
16. Confirm audit log rows exist for suggestion, edit or approve, send, and sent state.

