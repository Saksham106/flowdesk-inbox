# Task 4 Report: Writeback adapter + generalized processor

## Status: COMPLETE

## Implementation

### New: `lib/email/writeback-adapter.ts`
Verbatim from the brief. `EmailWritebackAdapter` type + `googleAdapter` / `microsoftAdapter`
+ `getWritebackAdapter(provider)`. Google adapter wraps `lib/google` fns; Microsoft adapter
wraps `lib/outlook-mailbox` fns. `createDraftReply` for Microsoft drops `channelEmail`
(Outlook derives recipients from the replied-to message).

### Rename+generalize: `lib/agent/gmail-writeback-processor.ts` → `email-writeback-processor.ts`
`git mv` preserved history. Applied the 8-point change-list:
1. Exports renamed: `processPendingEmailWritebackJobs`, `processEmailWritebackJobById`.
2. `recordWritebackResolution` gained an `auditPrefix: "gmail" | "outlook"` param; action is
   now `` `${auditPrefix}.writeback.${outcome}` ``.
3. `runWritebackJob` loads `channel.provider` first and resolves the adapter. Unsupported
   provider → job `completed`, audit `gmail.writeback.completed` with `result: "skipped"`,
   reason "channel provider does not support mailbox writeback" (degenerate case per decision).
   All provider calls go through the adapter; every `recordWritebackResolution` passes
   `adapter.auditPrefix`.
4. `handleCreateDraft(job, adapter)`: provider gate now `!getWritebackAdapter(provider) ||
   !externalThreadId` → skip "not a mailbox-writeback thread". Draft create/delete via
   `adapter.*`. New metadata writes use neutral keys (`providerDraftId`,
   `providerDraftSourceInboundMessageId`, `providerDraftSourceInboundAt`); clears delete BOTH
   neutral and legacy `gmailDraftId*` keys. `createdForSourceId` reads
   `providerDraftSourceInboundMessageId ?? gmailDraftSourceInboundMessageId`. Audit detail key
   `providerDraftId`.
5. `handleWithdrawDraft(job, adapter)`: reads via `providerDraftIdFromMetadata` (legacy
   fallback), deletes via `adapter.deleteDraft`, clears both neutral + legacy id keys.
6. Unknown-action copy: "Unknown email writeback action: ...".
7. Catch default "Unknown email writeback error"; log tags `[email-writeback]`.
8. Importers updated (below).

### `lib/gmail-drafts.ts`
Added `providerDraftIdFromMetadata` (reads `providerDraftId ?? gmailDraftId`).
`gmailDraftIdFromMetadata` retained, reimplemented to delegate to it.

### Importers
- `lib/scheduler/jobs.ts`: import path + fn rename; registry entry `gmail-writeback` →
  `email-writeback`.
- `app/api/cron/gmail-writeback/route.ts`: import + call rename (HTTP route path unchanged).
- `lib/gmail-labels.ts`: dynamic import → `@/lib/agent/email-writeback-processor` /
  `processEmailWritebackJobById` (kept dynamic — circular-import safety).
- `lib/agent/automation-runner.ts`: stale comment reference updated.

## TDD evidence

### RED
Temporarily disabled the `microsoft` branch in `getWritebackAdapter`, ran the new test:
```
tests/email-writeback-adapter.test.ts (6 tests | 4 failed)
  × routes an apply_labels job on a microsoft channel to the Outlook adapter
  × passes the raw providerMessageIds array to the Outlook mark-read call
  × creates an Outlook reply draft and records the neutral providerDraftId
  × backs off then fails out an Outlook apply_labels job that keeps throwing
```
(The google-dispatch and twilio-skip cases stayed green — they don't exercise the microsoft
branch.) Restored.

### GREEN
`tests/email-writeback-adapter.test.ts` → 6/6 pass. Targeted suite (adapter + all renamed
gmail-writeback tests + module-mock tests) → 46/46 pass.

## Files changed
- Added: `lib/email/writeback-adapter.ts`, `tests/email-writeback-adapter.test.ts`
- Renamed+modified: `lib/agent/gmail-writeback-processor.ts` → `lib/agent/email-writeback-processor.ts`
- Modified: `lib/gmail-drafts.ts`, `lib/scheduler/jobs.ts`,
  `app/api/cron/gmail-writeback/route.ts`, `lib/gmail-labels.ts`, `lib/agent/automation-runner.ts`
- Tests updated: `tests/gmail-writeback-labels.test.ts`, `tests/gmail-writeback-drafts.test.ts`,
  `tests/gmail-writeback-inline-drain.test.ts`, `tests/gmail-label-projection.test.ts`,
  `tests/workflow-status-route.test.ts`

## Changed test assertions (and why)
1. **All gmail-writeback prisma mocks**: added `channel: { findUnique }` returning
   `{ provider: "google" }`. Required — the generalized `runWritebackJob` now loads the
   channel provider before dispatch. Without it `channel.findUnique` is undefined and every
   job would throw.
2. **`gmail-writeback-labels.test.ts`** unknown-action: `lastError` assertion
   `"Unknown Gmail writeback action: mystery_action"` → `"Unknown email writeback action:
   mystery_action"`. Copy changed deliberately (change-list #6).
3. **`gmail-writeback-drafts.test.ts`** "creates a Gmail draft": metadata write assertion
   `{ gmailDraftId: "gmail-draft-1" }` → `{ providerDraftId: "gmail-draft-1" }`, and audit
   detail `gmailDraftId` → `providerDraftId`. New writes use neutral keys (deliberate).
4. **`gmail-label-projection.test.ts` / `workflow-status-route.test.ts`**: `vi.mock` module path
   `@/lib/agent/gmail-writeback-processor` → `@/lib/agent/email-writeback-processor`, export
   `processGmailWritebackJobById` → `processEmailWritebackJobById`. Path/name only.
5. **`gmail-writeback-inline-drain.test.ts`**: import path + export name + `describe` label
   updated to the renamed module; added the channel mock.

All other draft-scenario assertions were left byte-identical and still pass — the neutral-key
read path falls back to legacy `gmailDraftId*` metadata, and the invalidate/withdraw/preserve
scenarios' post-clear metadata is unchanged because deleting both neutral and legacy keys
leaves the same residual (`sourceInboundMessageId`/`sourceInboundAt`, or `intent`).

## Self-review
- **Gmail no drift**: claim (atomic `updateMany` pending→processing), backoff
  (`nextWritebackAttemptDate`, `GMAIL_WRITEBACK_MAX_ATTEMPTS`), and audit names
  (`gmail.writeback.completed|failed`) are byte-identical for google channels. Confirmed by the
  unchanged label/draft/inline-drain scenario assertions all passing.
- **Circular-import safety**: static chain is processor → adapter → {google, outlook-mailbox} →
  {gmail-labels, microsoft}. `rg` confirms none of google.ts / outlook-mailbox.ts / microsoft.ts /
  gmail-labels.ts statically imports the processor. `gmail-labels.ts` keeps its dynamic
  `await import(...)`, so the runtime edge back into the processor never becomes a static cycle.
- **Unknown-action / invalid-payload**: both still fail the job out (status `failed`,
  attempts +1) and audit under `adapter.auditPrefix` — verified by the labels-test unknown-action
  and invalid-payload cases plus the new outlook backoff/fail-out case.

## Verification
- `npx tsc --noEmit` → clean.
- `npx vitest run` → 142 files / 1192 tests pass (baseline 141/1186; +1 file, +6 tests = new
  adapter test).
- `npm run lint` → 0 errors (9 pre-existing `<img>` warnings in landing components, unrelated).

## Concerns
- `docs/` plan/spec artifacts (`docs/superpowers/plans/…`, `docs/superpowers/specs/…`) and
  `docs/TODO.md` still reference the old `gmail-writeback-processor.ts` path. These are historical
  plan/checklist records for this very work, so I left them untouched to avoid rewriting design
  history; flagging in case a docs sweep wants them updated.
- The HTTP cron route path is still `/api/cron/gmail-writeback` and the response header is still
  `X-Gmail-Writeback-Errors` (brief said route path unchanged). Fine for now, but a future task
  may want to rename these for provider-neutrality.

---

## Fix: reviewer Critical — suggest route dropped `providerDraftId` (duplicate provider drafts)

### Root cause
`app/api/conversations/[id]/draft/suggest/route.ts` rebuilds `metadataJson` from scratch on
every (re)suggestion and only preserved the LEGACY keys (`gmailDraftId`,
`gmailDraftSource*`). After Task 4 the writeback stamps the neutral `providerDraftId`, so a
re-suggestion silently dropped the stored id; the next create_draft writeback found no
existing id, skipped the delete-existing branch, and created a second mailbox draft on the
same thread. Regression for Gmail, also hit Outlook.

### Fix
- Suggest route now computes `preservedProviderDraftId` via `providerDraftIdFromMetadata`
  (neutral-first, legacy fallback) plus `providerDraftSourceInboundMessageId` /
  `providerDraftSourceInboundAt` with `gmailDraftSource*` fallback, and carries them into the
  rebuilt metadata under the NEUTRAL keys (legacy values are normalized forward). Legacy-only
  preservation spreads removed. Round-trip (writeback stamps neutral key → suggest rebuild →
  writeback reads it) now survives; verified by test.
- Reviewer Minor also fixed: `handleCreateDraft`'s replace path now deletes
  `gmailDraftId` / `gmailDraftSourceInboundMessageId` / `gmailDraftSourceInboundAt` from the
  spread metadata before writing the neutral keys, so a replaced legacy draft doesn't retain
  a stale `gmailDraftId` residue.

### TDD evidence
RED (before route fix), `npx vitest run tests/ai-draft-routes.test.ts`:
```
× preserves a neutral providerDraftId (and source keys) through the metadata rebuild on re-suggestion
× carries a legacy gmailDraftId forward (normalized to the neutral key) on re-suggestion
AssertionError: expected { intent: 'pricing', ... } to match object — "providerDraftId": "provider-draft-1" missing
Tests  2 failed | 9 passed (11)
```
GREEN (after fix):
```
npx vitest run tests/ai-draft-routes.test.ts tests/gmail-writeback-drafts.test.ts tests/email-writeback-adapter.test.ts
✓ tests/email-writeback-adapter.test.ts (6 tests)
✓ tests/gmail-writeback-drafts.test.ts (8 tests)
✓ tests/ai-draft-routes.test.ts (11 tests)
Tests  25 passed (25)
```

### Covering tests added
- `tests/ai-draft-routes.test.ts` — "preserves a neutral providerDraftId (and source keys)
  through the metadata rebuild on re-suggestion" (asserts both `create` and `update` payloads).
- `tests/ai-draft-routes.test.ts` — "carries a legacy gmailDraftId forward (normalized to the
  neutral key) on re-suggestion".
- `tests/gmail-writeback-drafts.test.ts` dedup case — new assertion that the replacement write
  is exactly `{ providerDraftId: "gmail-draft-1" }` (stale legacy `gmailDraftId` dropped).

### Verification
- `npx tsc --noEmit` → clean.
- `npx vitest run` → 142 files / 1194 tests pass (was 1192; +2 new suggest-route tests).
