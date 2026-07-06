# Codebase Audit — 2026-07-06

Read-only audit. No code was changed; this report is the only new file.

## Scope and method

Audited the working tree **plus `origin/main`**. Important context discovered during the audit:

- The working tree is on branch `fix/loading-states-panels` (PR #72, still OPEN), which is **1 commit ahead of and 8 commits behind `origin/main`**.
- Those 8 commits materially change the picture: PR #70 (MERGED) fixed regex duplication, Gmail `cid:` images, and added encryption-key rotation; commit `7e78e4b` added Gmail-native label projection (`lib/gmail-labels.ts`); commit `8035b3e`/`91a234b` pivoted the product direction to "Gmail-native AI email operator" (`docs/product-direction.md`) and rewrote parts of CURRENT_STATE, MASTER_PRODUCT_PLAN, TODO, and the 2026-06-25 GitHub audit.
- Where a file differs between branch and main, findings below cite the **main** version and say so. Everything else is identical on both.
- PR #70 (`fix/issues-64-40-41`) is MERGED — SESSION_HANDOFF.md's "status unknown" is resolved.

**Recommendation before any fixes: rebase/merge `origin/main` into the working branch (or land PR #72 and start from main).** Several findings in the June audits are already fixed there.

## Verification results

| Check | Result |
|---|---|
| `npm test` (vitest) | **697/697 passed** (85 files, 13.2s) |
| `npm run lint` | **Clean** (exit 0, no warnings) |
| `npx tsc --noEmit` | **46 errors — all stale local state, no real code bugs** (see §4) |

---

## P0 — correctness / security / data loss

**None found.** The closest candidates are P1-1 (silent feature death) and P1-2 (breaks Outlook sync after key rotation, recoverable by re-subscribing/re-syncing).

The June-25 audit's P0 (“`InboxTask.taskId` schema drift in `AppListColumn.tsx` BillSignal”) is **invalid/obsolete**: `BillSignal` lives in `lib/agent/command-center.ts:868`, not AppListColumn, and its `taskId` is simply `InboxTask.id` (`command-center.ts:908`), consumed by `app/components/BillsDeadlinesList.tsx:26` as `PATCH /api/tasks/:id/status`. No missing column, no runtime join problem. Closed.

---

## P1 — bugs, drift, unclosed audit items

### P1-1. The entire AgentJob execution pipeline is dead in production
`lib/agent/jobs.ts:29` (`createAgentJob`) and `lib/agent/jobs.ts:47` (`runAgentJob`) have **zero production callers** — only tests import them. Meanwhile two crons enqueue jobs that nothing ever executes:
- `lib/agent/follow-up.ts:103` creates `AgentJob(trigger: "follow_up")`
- `lib/agent/lead-sequence.ts:132` creates `AgentJob(trigger: "lead_follow_up")`

Jobs accumulate as `pending` forever. Consequently the whole chain reachable only through `runAgentJob` never runs in production: LLM classification (`lib/agent/classify.ts`), policy check (`lib/agent/policy.ts`), availability tool (`lib/agent/availability.ts`), autonomy evaluation (`lib/agent/autonomy.ts`), and **autopilot send (`lib/agent/autopilot.ts:111`)**. The agentic-architecture audit's "autopilot practically never triggers" understates it — autopilot *cannot* trigger. MASTER_PRODUCT_PLAN's feature index listing "Autopilot Modes: Shipped" and "AI Follow-Up Brain: Partial (shipped)" is misleading; users can configure settings for an engine that never runs, and follow-up "processed" counts report jobs that go nowhere.
**Fix:** add a cron/executor that drains pending `AgentJob`s (e.g. `GET /api/cron/agent-jobs` calling `runAgentJob` with a bounded batch), or stop enqueueing and mark the feature unimplemented. This is also the gating prerequisite for Stage 1 (see §9).

### P1-2. Key-rotation endpoint misses two encrypted Outlook fields (main only)
`app/api/admin/rekey/route.ts:84-101` (on `origin/main`) re-encrypts only `accessTokenEncrypted`/`refreshTokenEncrypted` for `OutlookCredential`, skipping **`deltaLinkEncrypted` and `subscriptionClientStateEncrypted`** (`prisma/schema.prisma:206,209`). After a rotation completes and `ENCRYPTION_SECRET_PREVIOUS` is unset (the documented procedure in the route header), `decryptString` throws for those rows: delta sync crashes on cursor decrypt (`lib/outlook-sync.ts:241`) and webhook validation 401s all notifications (`lib/outlook-notifications.ts:58`). Recovery requires cursor reset + re-subscription, silently losing incremental sync in the meantime.
**Fix:** add both fields to the Outlook block of the rekey loop.

### P1-3. Four Gmail cron routes accept `Bearer undefined` when CRON_SECRET is unset
`app/api/cron/gmail-push-retry/route.ts:10`, `gmail-state-reconcile/route.ts:11`, `gmail-watch/route.ts:13` (and `:99`), `gmail-writeback/route.ts:14` all use `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` with **no unset guard**. If CRON_SECRET is missing in an environment, sending the literal header `Authorization: Bearer undefined` authenticates. All other cron routes guard `if (!secret) return 401` (e.g. `app/api/cron/outlook-sync/route.ts:8`).
**Fix:** copy the guarded pattern into the four Gmail routes.

### P1-4. CC/BCC UI collects addresses the send API silently drops
`app/conversations/[id]/ReplyComposer.tsx:56-58` renders editable CC/BCC fields; `:152` has the TODO "wire cc/bcc into send API when backend supports it". `app/api/conversations/[id]/send/route.ts:21` reads only `text`. A user who fills in CC and hits Send gets a success state while the CC recipient never receives anything. CURRENT_STATE documents the limitation, but the UI actively implies it works — this violates the "known limitations must be cleanly bounded" bar (§8 of the audit brief).
**Fix (either):** wire `cc`/`bcc` through `sendConversationMessage` → provider send; or hide/disable the fields with a "coming soon" hint until then. Hiding is a 10-minute change.

### P1-5. User-edited task due dates are overwritten by the next sync
CURRENT_STATE claims "Persistence never overwrites records with source `user`". That's enforced for `ConversationState` (`lib/agent/work-item-sync.ts:93-98` checks `user_override`) but **not for `InboxTask`**: `PATCH /api/tasks/:id/due` (`app/api/tasks/[id]/due/route.ts:33`) updates `dueAt` without setting any user-source flag, and the sync upsert (`lib/agent/work-item-sync.ts:173-179`) unconditionally overwrites `title`, `dueAt`, `source`, and `metadataJson` on the same `deterministicKey`. A user who corrects a bill's due date will see it revert on the next Gmail/Outlook sync of that conversation. Same pattern applies to `Lead` field updates (`work-item-sync.ts:221-231`), though lead `stage`/`score` are preserved.
**Fix:** on user edit, set `source: "user"` (or a `userEditedFields` metadata flag) and make the sync `update` branch skip or merge-protect user-sourced records — matching the documented invariant.

### P1-6. Outlook worker still swallows renewal/sync error causes (unclosed June-25 P2, upgraded by recurrence)
`lib/outlook-worker.ts:106-108`: subscription renewal failures are `catch { errors++ }` — no log, no `subscriptionError` update, no audit entry, even though the schema has `subscriptionError` (`prisma/schema.prisma:211`) and `ensureOutlookSubscription` can set it only for failures it sees internally. Sync failures at `:74-85` collapse the real exception into the constant string `"sync_failed"`. Operators alerting on `X-Outlook-Sync-Errors` get a count with no cause anywhere.
**Fix:** record `err.message` into `OutlookSyncEvent.lastError` and `OutlookCredential.subscriptionError`, plus an `auditLog` row for renewal failures.

### P1-7. Outlook stale-fallback skips channels whose event-sync just failed (unclosed main-audit P1)
`lib/outlook-worker.ts:126`: `processedChannels` includes channels whose webhook-event sync **threw or was deferred**, so the stale-mailbox fallback in the same run skips them. Combined with P1-6 the failure is invisible. The event does get rescheduled (5 min), so this is a delay/observability bug rather than permanent loss — but it is exactly the regression flagged as P1 in main's `docs/github-audit-2026-06-25.md`, still unfixed.
**Fix:** only add to `processedChannels` on successful, complete sync.

### P1-8. Two LLM call paths bypass budget, usage tracking, and model config
- `lib/agent/inbox-chat.ts:31` (`/api/chat`): streams a completion per user message with **no `checkAiBudget` call, no `recordAiUsageEvent`, hard-coded `gpt-4o-mini`**, and a module-level `new OpenAI()` (`:4`) that throws at import time if `OPENAI_API_KEY` is unset (crashes the route rather than 503ing).
- `lib/agent/rule-compiler.ts:68` (agent-rules create/preview): same — no budget check, no usage event, hard-coded model.

Every other LLM entry point pre-flights the budget (`lib/agent/jobs.ts:162`, `lib/agent/autopilot.ts:210`, `lead-scoring.ts:45`, `reply-learning.ts:118`, `person-memory.ts:261`, draft-suggest/explain/meetings routes). Chat is the worst offender because it's unbounded per-user-message spend.
**Fix:** add `checkAiBudgetForTokens` + `recordAiUsageEvent` to both; use `process.env.OPENAI_MODEL` fallback consistently; construct the OpenAI client inside the function.

### P1-9. Documentation drift (CURRENT_STATE / TODO / MASTER_PRODUCT_PLAN on main)
Verified against code; all of these are wrong in the docs **as they exist on `origin/main`**:

1. **Bills & Deadlines dismiss endpoint** — doc says billing alerts "reclassify to `fyi_done` via `PATCH /api/conversations/:id/attention`". Code (`app/components/BillsDeadlinesList.tsx:32-36`) calls `PATCH /api/conversations/:id/workflow-status` with `{workflowStatus: "done"}`.
2. **Read Later ✓/✕ endpoints** — doc says "persisted via `PATCH /api/conversations/:id/attention`". Code (`app/components/ReadLaterSection.tsx:47,73`) calls the workflow-status endpoint.
3. **Quietly Handled link** — doc says "Review all" links to `/inbox?attention=fyi_done`. Code (`app/components/QuietlyHandledBanner.tsx:36`) links to `/inbox?status=closed` (changed in commit `69ca024`).
4. **Gmail `cid:` images** — CURRENT_STATE "Important limitations" and TODO both still list cid images as unresolved, but main's `lib/google.ts` implements `resolveInlineCids` and calls it in the sync path (google.ts:313 on main), with sanitizer support for safe raster `data:` URIs (`lib/email-body.ts:44` on main). This is implemented-but-documented-as-missing. (Messages synced *before* the fix still have unresolved `cid:` srcs — worth a one-line caveat if backfill isn't planned.)
5. **TODO "Consolidate command-center and inbox heuristics"** — partially done by PR #70 (regexes + `FYI_EMAIL_TYPES` now shared from `lib/inbox-fyi.ts`); the item should be narrowed to what remains (see P2-6).
6. **MASTER_PRODUCT_PLAN feature index** — "Autopilot Modes: Shipped" is wrong given P1-1 (settings UI shipped; engine never executes). "AI Follow-Up Brain: Partial — follow-up tracker shipped" likewise overstates: the cron only enqueues dead jobs.
7. **README model default** — README says `OPENAI_MODEL` recommended `gpt-5.4-mini`; code fallbacks are inconsistent: drafts/style default `gpt-5.4-mini` (`lib/ai/openai.ts:55`) but classify (`lib/agent/classify.ts:21`), chat, and rule-compiler default/hard-code `gpt-4o-mini`.

### P1-10. SESSION_HANDOFF.md contradiction (explicitly requested check)
`SESSION_HANDOFF.md` exists **untracked** in the repo root (`git status` shows `??`; `git ls-files` empty — so it is *not* tracked, contrary to the brief's phrasing). But its own claim "Added SESSION_HANDOFF.md to `.gitignore`" is **false**: `.gitignore` contains no such entry (verified full file), and `git check-ignore` exits 1. One `git add -A` away from committing a file `docs/README.md:10` explicitly prohibits ("do not add handoff files"). Additionally `docs/superpowers/plans/*.md` (3 plan files across branch+main) violate the same policy ("Completed specs and implementation plans live in Git history, not the working tree").
**Fix:** add `SESSION_HANDOFF.md` to `.gitignore`; delete or relocate the retained plan files (or amend the docs policy to allow a `plans/` exception).

---

## P2 — quality, half-wired features, observability

### P2-1. Snooze dismiss writes an invalid priority
`app/api/conversations/[id]/snooze/route.ts:77` restores `priority: "normal"`, which is not in the priority vocabulary (`urgent|high|medium|low|none` — `lib/agent/command-center.ts:21`; snooze itself sets the also-nonstandard `"snoozed"` at `:50`). A persisted state with priority `"normal"` makes `score()`'s `priorityScore[priority]` lookup `undefined` → `NaN` → broken sorting in top-actions for that conversation while the persisted state is fresh.
**Fix:** restore the pre-snooze priority (save it in metadata at snooze time), or `"medium"` as a safe default.

### P2-2. `FlowDesk/Handle First` Gmail label is unreachable (main only)
`lib/gmail-labels.ts:58` (on main) applies the label when `attentionCategory === "handle_first"`, but `handle_first` is not a value the classifier or corrections can produce (taxonomy: `needs_reply|needs_action|review_soon|read_later|waiting_on|fyi_done|quiet` — see `lib/agent/rule-compiler.ts:77`). The label is declared in the vocabulary and in the product-direction doc but can never be applied.
**Fix:** map it from the command-center's top-action selection instead, or drop it from the vocabulary until wired.

### P2-3. Two parallel approval mechanisms; `ApprovalRequest` is nearly vestigial
Only **one** production site creates `ApprovalRequest`s: meeting follow-up (`app/api/meetings/follow-up/route.ts:159`). The primary draft approval flow runs entirely on `Draft.status` (`proposed → approved → sent`, `app/api/conversations/[id]/draft/route.ts`, `send-approved/route.ts`), so the `/approvals` page (`app/approvals/page.tsx:21`) sees only meeting follow-ups, and `approvals/[id]/decide` flips a status without sending anything. CURRENT_STATE's "AI drafts with … human approval gates" is true via Draft.status, but the Approval Queue feature (MASTER_PLAN #28 "Partial") supervises almost nothing. Directly relevant to Stage 1/tiered approvals — see §9d.

### P2-4. `create_draft` automation step declared but unimplemented
`lib/agent/automation-runner.ts:5` includes `"create_draft"` in the step type union; execution falls through to `Unknown step type` failure (`:100`). Any workflow template seeded with a create_draft step fails at runtime. Note the June-25 audit's "missing audit logs in automation-runner steps" is now **fixed** — all three implemented steps write audit rows (`:42`, `:65`, `:90`).

### P2-5. Contact identity keyed on `phoneE164` holding email addresses (unclosed June-25 P2)
`prisma/schema.prisma:270-276` (`Contact.phoneE164`, `@@unique([tenantId, phoneE164])`); both Gmail (`lib/google.ts:244`) and Outlook (`lib/outlook-sync.ts:135`) store the **email address** in this field. Cross-provider dedupe by email is arguably correct behavior, so nothing is broken today — but the field name is a landmine for the deferred Twilio/SMS channel (a phone number and an email could never collide in practice, yet the semantics are undocumented) and for any future per-provider identity needs.
**Fix (cheap):** rename to `identifier` via migration, or add `emailAddress` and backfill; document the dedupe-by-email decision.

### P2-6. Remaining classification-heuristic duplication (what's left after PR #70)
PR #70 consolidated the three regexes and `FYI_EMAIL_TYPES` into `lib/inbox-fyi.ts` (exported; imported by `command-center.ts` on main). Still duplicated:
- `IGNORABLE_ATTENTION_CATEGORIES` (`lib/agent/command-center.ts:173`) ≡ `FYI_ATTENTION` (`lib/inbox-fyi.ts:17`) ≡ `LOW_PRIORITY_ATTENTION` (`lib/gmail-labels.ts:24`, main) — three copies of `{"quiet","fyi_done"}`.
- The *decision logic* `isFyiConversation` (`inbox-fyi.ts:20-56`) vs `isSafelyIgnorable` + `isAutoEmail` (`command-center.ts:275-299,397-402`) implement the same precedence (attention category → emailType → state → sender/body regex) independently; they can disagree when `stateRecord.state === "fyi_only"` but metadata carries a non-FYI attention (inbox-fyi returns true at `:48`; command-center's `isSafelyIgnorable` returned false earlier at `:278`).
- `lib/agent/email-classifier.ts` keeps its own richer pattern set — this is by design (it *produces* `emailType`/attention; the others *consume*), and should stay separate.

**Single consolidation point:** move the shared attention-category sets and an `isIgnorableAttention()` / `classifyIgnorability(stateRecord, contact, messages)` helper into one module (extend `lib/inbox-fyi.ts` or a new `lib/agent/email-signals.ts`), consumed by command-center, inbox-fyi, and gmail-labels. That closes the "edge-case overlap" limitation in CURRENT_STATE with one importer-visible seam.

### P2-7. Fire-and-forget async blocks without rejection handlers
`lib/agent/work-item-sync.ts:666` (attachment extraction) and `:702` (second-brain facts) are `void (async () => { …prisma writes… })()` with no `.catch`. A DB error inside them becomes an unhandled promise rejection (process-fatal on Node ≥15 defaults). The lead-scoring fire-and-forget at `:255` does it right (`.catch(() => {})`).
**Fix:** append `.catch(() => {})` (or log) to both IIFEs.

### P2-8. Schema: hot-path index gaps and audit-log-as-store
- `Conversation` is filtered by `{tenantId, status}` (+ `userState`) in inbox views and `bulk-close`/`close-fyi` (`app/inbox/page.tsx:131`, `app/api/admin/close-fyi/route.ts`), but only `@@index([tenantId, lastMessageAt])` exists (`schema.prisma:338`). Add `@@index([tenantId, status, lastMessageAt])`.
- `AuditLog` doubles as an operational store: autopilot's daily-send cap counts `action: "autopilot.send"` rows (`lib/agent/autopilot.ts:160-166`) and clean-inbox undo looks up rows by **JSON path** `payloadJson.batchToken` (`app/api/clean-inbox/undo/[batchToken]/route.ts:25`) — both scan within `@@index([tenantId, createdAt])` only. Add `@@index([tenantId, action, createdAt])`; consider a real `CleanInboxBatch` record if undo grows.
- `metadataJson` fields stable enough to promote to columns (`ConversationState`): `attentionSource`, `attentionConfidence`, `phishingVerdict`, `hasUnsubscribeLink` — all are read structurally by UI/filters every render and already have stable shapes since June. (`attentionCategory`/`emailType`/`isSalesLead`/`isSupport` were already denormalized in migration `20260617002000`.)
- No unused models: every model in `schema.prisma` has ≥1 `prisma.<model>` call site (verified by sweep). No migration/code mismatch found — migration `20260624010000_add_outlook_delta_sync` matches the schema; the local tsc errors are a stale generated client, not drift (§4).

### P2-9. Dead/orphaned code
- **`app/components/ScrollReveal.tsx`** — zero importers. Safe to delete.
- **`generatePersonalStyleProfile`** (`lib/ai/provider.ts:31`) and its backing `generatePersonalStyleProfileWithOpenAI` (`lib/ai/openai.ts:128`) — zero callers (the actual style training goes through `lib/agent/reply-learning.ts`). Safe to delete both.
- **`app/api/admin/close-fyi/route.ts`** — no UI reference; session-guarded curl utility. Keep or fold into a documented admin page, but don't polish.
- **The `jobs.ts → classify/policy/autonomy/availability/autopilot` chain** — production-orphaned (P1-1) but **NOT safe to delete**: it's the substrate the agentic roadmap builds on. Wire it up instead.
- Local-env staleness (not code): `geist` is in `package.json` but absent from `node_modules`, and the generated Prisma client predates the Outlook migration. `npm install && npx prisma generate` fixes all 46 tsc errors.

### P2-10. Bills & Deadlines "Done" vs "Not relevant" buttons are identical
`app/components/BillsDeadlinesList.tsx:63,71` — both buttons call the same `handleDismiss`, which marks the conversation done. "Not relevant" should presumably reclassify attention (e.g. `quiet`) rather than complete the task. Minor UX dishonesty; also the doc-drift companion of P1-9(1).

---

## P3 — nice-to-have

1. **Gmail push secret in query string** (`app/api/connectors/gmail/push/route.ts:10`) — `?secret=` URLs can leak into proxy/access logs; the `x-flowdesk-secret` header path already exists, prefer it in docs. Comparison is also non-constant-time (as are cron bearer checks) — negligible risk, cheap to switch to `timingSafeEqual`.
2. **OpenAI client hygiene** — no timeout/retry configuration on any call (`lib/ai/openai.ts`); a hung request holds the route open. Set `timeout`/`maxRetries` in the client constructor.
3. **`cid:` in the iframe CSP** (`lib/email-iframe.ts:15`) — `cid:` sources can't resolve in a `srcdoc` iframe; now that main resolves cids to `data:` URIs at sync time, the `cid:` scheme allowance mostly yields broken-image icons for pre-fix messages. Harmless; tidy later.
4. **Landing/marketing** — footer placeholder `href="#"` links (flagged in main's June-25 audit; still present).
5. **`gpt-5.4-mini` missing from `MODEL_PRICING`?** — actually present (`lib/ai/budget.ts:11`); unknown models fall back to conservative pricing. No action; noted because the README implies model freedom.
6. **Email sanitization/CSP status: verified healthy, no regression.** Strict allow-list via `sanitize-html` both inline (`lib/email-body.ts:9`) and iframe (`:56`, script/iframe/object stripped, `http-equiv` not allowed on `<meta>` so CSP can't be overridden); iframe sandbox has no `allow-scripts` (`lib/email-iframe.ts:8`); CSP `default-src 'none'`, images gated on explicit opt-in. Remote-image privacy default intact.
7. **Webhook/push authenticity: verified.** Gmail push requires the shared secret before any work; Outlook webhook validates `clientState` with constant-time compare against the per-subscription encrypted value before queueing (`lib/outlook-notifications.ts:57-64`), queues hints only, never does Graph work inline.
8. **Tenant isolation: verified across all 67 non-cron API routes.** Every route resolves `session.user.tenantId` and either scopes the Prisma `where` directly or does a tenant-scoped `findFirst` before writing through a unique key (spot-checked the lowest-margin routes: phishing-safe, snooze, vip-contacts/[id], leads, approvals, automation rollback, clean-inbox undo). No unscoped query found. Cron routes iterate tenants explicitly. OAuth callbacks verify signed/DB-checked state before touching tenant data.
9. **Encryption at rest: verified.** All OAuth tokens, the Outlook delta cursor, and webhook `clientState` are encrypted via AES-256-GCM (`lib/crypto.ts`); production throws without `ENCRYPTION_SECRET`; no token/cursor/clientState value is logged anywhere (grep-verified — the only "secret"-adjacent logs are the CRON_SECRET-unset warnings).

---

## §4 Type health (detail)

`npx tsc --noEmit` on the working tree: **46 errors, all environmental**:
- `app/layout.tsx:2-3` — `geist/font/*` unresolved: `geist@^1.7.2` is in `package.json` but not installed locally. Run `npm install`.
- 44 errors across `lib/outlook-{notifications,subscriptions,sync,worker}.ts` — the generated Prisma client in `node_modules/.prisma/client` predates migration `20260624010000_add_outlook_delta_sync` (verified: generated schema contains neither `deltaLinkEncrypted` nor `OutlookSyncEvent`). The checked-in `prisma/schema.prisma` **does** contain every referenced field. Run `npx prisma generate` (and `npm run db:deploy` against a live DB).

SESSION_HANDOFF's "pre-existing errors from migration not applied — ignore" is directionally right but imprecise: the fix is `npm install && npx prisma generate`; no code change needed. CI presumably regenerates, which is why main merges green.

## §8 Consistency of known limitations

- **Outlook archive/trash writeback absent** — cleanly bounded. Server rejects non-Google (`app/api/conversations/[id]/archive/route.ts:32-35`), and the UI renders Archive/Trash only when `isGmail` (`app/conversations/[id]/ThreadStatusHeader.tsx:172`, `app/components/InboxRow.tsx:272`). No UI implies it works.
- **CC/BCC** — NOT cleanly bounded; see P1-4.
- **Gmail `cid:` images** — fixed on main for newly synced mail; docs stale (P1-9.4); historical messages unresolved (acceptable, worth a doc line).

---

## §9 Agentic readiness

**First, a framing correction:** `docs/agentic-architecture-audit.md` (2026-06-24) is no longer the sole roadmap. `docs/product-direction.md` (main, 2026-06-25) pivots to a Gmail-native operator with Milestones 1–5 (labels → Gmail drafts → waiting-on/follow-up → control-room dashboard → add-on/extension). The two are compatible — Milestone 2 ≈ "proactive drafts", Milestone 3 ≈ "cross-conversation follow-up" — but Stage 1 work should now land *in Gmail* (drafts as real Gmail drafts, states as labels), not as dashboard-only features. The refactor list below reflects both documents.

### 9a. Are the audit's gap claims still true?

| Claim | Verdict | Evidence |
|---|---|---|
| Corrections not fed into prompts | **True** for LLM prompts — `lib/ai/prompts/classify.ts` and `draft-reply.ts` take no correction/few-shot input. But a *deterministic* learning loop exists and works: `ClassificationCorrection` → threshold(3) → suggested `SenderRule` → rule application beats AI (`lib/agent/preference-learning.ts:28-74,110-136`; applied in `work-item-sync.ts:406`). |
| Autopilot never firing in practice | **True, and stronger than claimed** — the executor is never invoked (P1-1). The gate chain itself is sound and tested. |
| AgentJob stateless/per-conversation | **True** — `conversationId` required, single `trigger` string, no goal/step linkage (`schema.prisma:538-559`). `lead-sequence` smuggles step state through `slotsJson`, confirming the missing abstraction. |
| No tools beyond classify + availability | **True** — `AgentToolCall` rows are only created for `classifyConversation` (`jobs.ts:140`) and `checkAvailability` (`jobs.ts:233`). |

### 9b. Stage 1 features vs current abstractions

- **Proactive drafts (≈ Milestone 2)** — *Mostly supported once P1-1 is fixed.* Draft generation with style/knowledge/budget context is production-hardened (`getReplyGenerationContext`, `attemptAutopilotSend`'s draft phase, draft-suggest route). What must change: (1) an executor (P1-1); (2) split `attemptAutopilotSend` into `generateApprovedDraft` + `sendDraft` so proactive drafting can stop at `proposed` + `ApprovalRequest` without the send half; (3) `Draft` is unique-per-conversation (`schema.prisma:363`) — fine for v1, blocks draft history/regeneration comparison; (4) per product direction, drafts should also be written to Gmail via a new `GmailWritebackQueue` action (`create_draft`), mirroring the shipped `apply_labels` pattern (`lib/gmail-labels.ts` + writeback cron on main) — that queue is the right chassis and needs no redesign.
- **Unified "Handle This"** — *Needs refactoring first.* Today it's a single fetch to draft/suggest (`app/conversations/[id]/HandleThisPanel.tsx:34`). Chaining draft + task extraction + follow-up needs a multi-step container: either the proposed `AgentGoal` model or an interim `stepsJson` on AgentJob. `AutomationRun`/`executeAutomationStep` is the closest existing multi-step executor and could be generalized (it already has step status, rollback data, tenant guards) rather than inventing a third runner.
- **Cross-conversation follow-up (≈ Milestone 3)** — *Data model supports it; execution doesn't.* Outbound-no-reply detection is a simple query over `Conversation.lastMessageAt` + latest message direction (both indexed); `getStaleConversations` (`lib/agent/follow-up.ts:33`) is 90% of it. Blocked by P1-1 (its output goes into dead jobs). The Gmail-native version additionally wants `Waiting On`/`Follow Up` label writeback, which `flowDeskLabelsForConversationState` already models (`followUpDue` input, gmail-labels.ts:36).
- **Correction learning loop** — *Partially moot until LLM classification actually runs (P1-1).* The operative classifier in production is the deterministic `email-classifier` + SenderRules; feeding few-shot corrections into `buildClassifyPrompt` only pays off once `runAgentJob` executes. The `LearningEvent`/`AgentPreference` models from the audit are additive migrations; nothing blocks them.

### 9c. Code Stage 1–2 will replace — don't polish in hygiene fixes

- `lib/agent/jobs.ts` orchestration internals (goal-based redesign planned) — fix P1-1 with a thin executor, don't refactor its guts.
- `lib/agent/autonomy.ts` (audit explicitly calls for dynamic redesign of `evaluateAutonomy`).
- Binary `ApprovalRequest` semantics and the `/approvals` page (tiered `ApprovalRule` redesign) — unify producers (see 9d) but skip cosmetic work.
- `HandleThisPanel.tsx` wiring (becomes goal-creating).
- `AgentActivitySection` (superseded by the proposed `AgentActivityLog` model).
- Dashboard inbox-list surface polish generally: product direction repositions the website as a control room; Gmail is the daily surface. Deprioritize inbox-shell UX investments beyond what Milestone 4 needs.

### 9d. Can ApprovalRequest + the gate chain extend to tiered approvals without a rewrite?

**Yes, with one structural precondition.** The gate chain is well-factored: `checkPolicy` (pure), `checkAutopilotEligibility` (policy→enabled→confidence→per-intent threshold→allow-list, `lib/agent/autopilot.ts:17-74`), `evaluateAutonomy` (profile/risk/caps/failures), and the budget gate are sequential, independently testable functions — adding a tier/`ApprovalRule` lookup is another link in the same AND-chain, no rewrite. `ApprovalRequest` extension is additive: `step`, `ruleId`, `ruleMode`, `autoCancelAt` columns per the audit's sketch.

The precondition: **collapse the dual approval tracks first** (P2-3). Tiered approvals are meaningless while the main draft flow bypasses `ApprovalRequest` entirely via `Draft.status`. Make draft-propose create an `ApprovalRequest(step: "send", draftId)` and have approve/send routes resolve it; keep `Draft.status` as a derived projection. That's a contained change to `draft/route.ts`, `draft/suggest/route.ts`, `send-approved/route.ts`, and the approvals page.

### Recommended refactor-before-build list (minimum, in order)

1. **AgentJob executor** (P1-1) — cron that drains pending jobs, bounded batch, per-tenant fairness. Everything else in Stage 1 assumes work executes.
2. **Unify approvals onto ApprovalRequest** (P2-3/9d) — before any proactive drafting creates review volume.
3. **Split draft-generation from autopilot-send** in `lib/agent/autopilot.ts` — enables proactive drafts at `proposed` without touching send policy.
4. **Generalize the writeback-queue pattern** — `GmailWritebackQueue.action` gains `create_draft`; keep the labels implementation as the template. (Outlook parity slots in later behind the same interface.)
5. **Budget-gate the stragglers** (P1-8) — before agent-initiated LLM volume grows.
6. **Finish heuristic consolidation** (P2-6) — one `email-signals` seam, so label projection, command center, and inbox list can't disagree about "ignorable".

---

## (a) Proposed TODO.md diff (against `origin/main`'s TODO.md)

```diff
 ## Near term

+- [ ] Wire an executor for pending AgentJobs (follow-up, lead-sequence, classification/autopilot) — or stop enqueueing them. They currently never run.
+- [ ] Extend /api/admin/rekey to re-encrypt OutlookCredential.deltaLinkEncrypted and subscriptionClientStateEncrypted.
+- [ ] Guard unset CRON_SECRET in the four gmail-* cron routes (reject before Bearer comparison).
+- [ ] Add budget check + usage recording to inbox chat and agent-rule compiler LLM calls; respect OPENAI_MODEL.
+- [ ] Preserve user-edited InboxTask dueAt/title across work-item sync (source guard on upsert).
+- [ ] Record Outlook renewal/sync failure causes (subscriptionError, OutlookSyncEvent.lastError, audit log) and stop skipping failed channels in the stale fallback.
+- [ ] Hide or wire the reply-composer CC/BCC fields (currently collected and silently dropped).
+- [ ] Fix snooze-dismiss priority restore ("normal" is not a valid priority).
+- [ ] Fix FlowDesk/Handle First label mapping — "handle_first" is not a produced attention category.
+- [ ] Implement or remove the create_draft automation step type.
+- [ ] Unify draft approvals onto ApprovalRequest (precondition for tiered approvals).
+- [ ] Add SESSION_HANDOFF.md to .gitignore; remove retained plan files per docs policy.
+- [ ] Update CURRENT_STATE: dashboard dismiss endpoints (workflow-status, not attention), Quietly Handled link (status=closed), move cid: images from limitations to implemented (note pre-fix messages unresolved).
 - [ ] Bootstrap FlowDesk Gmail labels on account connect and scheduled maintenance.
 ...
-- [ ] Consolidate command-center and inbox auto-email/classification heuristics.
+- [ ] Finish heuristic consolidation: shared attention-category sets + single isIgnorable helper used by command-center, inbox-fyi, and gmail-labels (regex constants already shared).
-- [ ] Resolve Gmail inline `cid:` images safely.
+- [ ] (Optional) Backfill cid: resolution for messages synced before PR #70.
```

## (b) Files safe to delete

| File | Why |
|---|---|
| `app/components/ScrollReveal.tsx` | Zero importers. |
| `lib/ai/provider.ts:31-35` (`generatePersonalStyleProfile`) + `lib/ai/openai.ts:103-210` (`generatePersonalStyleProfileWithOpenAI` + its schema) | Zero callers; style training uses `reply-learning.ts`. |
| `SESSION_HANDOFF.md` (untracked) | Prohibited by docs policy; content stale (PR #70 status resolved, PR #72 known). Gitignore it if the /handoff workflow stays. |
| `docs/superpowers/plans/*.md` (3 files across branch+main) | docs/README.md policy: completed plans live in git history. Confirm the two 06-25 plans are fully landed first (dashboard polish appears landed; gmail-native plan is the active roadmap — keep that one until Milestones 1–3 finish, or fold into product-direction.md). |

**Explicitly NOT safe to delete:** `lib/agent/{jobs,classify,policy,autonomy,availability,autopilot}.ts` and `lib/ai/prompts/classify.ts` — production-orphaned today (P1-1) but they are the Stage-1 substrate.

## (c) Five highest-leverage fixes for a follow-up PR

1. **AgentJob executor cron** (P1-1) — turns three dead features (LLM classification, follow-up jobs, autopilot) back on and unblocks the entire agentic roadmap. ~1 route + tests.
2. **Rekey coverage for Outlook cursor/clientState** (P1-2) — prevents silent Outlook sync breakage on the documented rotation path. ~6 lines.
3. **CRON_SECRET unset guard in gmail-* crons** (P1-3) — closes an auth hole with the pattern already used next door. ~8 lines.
4. **Budget + usage on chat and rule-compiler** (P1-8) — caps the only unmetered LLM spend paths before proactive AI increases volume.
5. **User-edit preservation in work-item sync** (P1-5) — honors the product's core trust invariant ("explicit user intent survives sync") where it's currently violated.

*(If a sixth slot exists: hide the CC/BCC fields — smallest change with direct user-trust impact.)*
