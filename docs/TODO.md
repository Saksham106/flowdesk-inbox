# Remaining Work

Last updated: 2026-07-08 (MVP refocus)

Reprioritized around shipping a **tight MVP** (`docs/product-direction.md` → MVP definition): the trustworthy core loop is done and reliable; the blocker to a shippable product is that ~45 features are almost all half-built. Order of work is now **complete the core loop (the first-run organize moment) → make it fast → tighten the default path → then polish and breadth.** The Sales & CRM cluster and all half-built peripheral surfaces stay deferred (opt-in / off the default path) until the MVP ships.

Coordination rule: before starting a lane, fetch `origin/main`, branch from the latest main in a fresh worktree, and claim the active item here or in the PR description. Clear the claim when the PR merges or is abandoned so duplicate branches do not linger.

## Phase 1 — Trustworthy core loop — shipped

The loop *classify → act in Gmail → reflect state truthfully in the UI* is now reliable. Detail in `docs/MASTER_PRODUCT_PLAN.md` decision log (2026-07-08 entries) and `docs/CURRENT_STATE.md`.

- [x] **Labels are created but never applied to threads** — fixed: `queueFlowDeskLabelWriteback` (`lib/gmail-labels.ts`) best-effort drains the job it just queued inline via `lib/agent/gmail-writeback-processor.ts`, instead of depending entirely on the `gmail-writeback` cron. The cron remains the retry backstop for whatever the inline attempt can't finish.
- [x] **"Mark done" / state changes don't stick on refresh** — fixed: `analyzeConversationForCommandCenter` (`lib/agent/command-center.ts`) checks the explicit user decision (`userState`) before any draft-ready/AI-derived signal, and `needsAction`/`readLater` are gated by `userState` too so a resolved conversation can't resurface in other dashboard sections. Verified live: a conversation marked done stays done even with a "proposed" draft and stale `needs_action` metadata reintroduced after the fact.
- [x] **Implement or remove the `create_draft` automation step type** — removed: it was unreachable dead code (no trigger/template ever constructed one); the working Gmail-native draft system is unrelated writeback lane.
- [x] **End-to-end verification pass** — done live against a running dev server + local Postgres for both the mark-done and label-writeback fixes.
- [x] **Task dismiss (Bills & Deadlines) reappearing on refresh** — fixed: `/api/tasks/[id]/status` now calls `revalidateInboxViews` (it never did before), matching the pattern the workflow-status route already used.
- [x] **Read Later "+N more" badge going stale after a dismiss** — fixed: preview/overflow are now computed from the currently-visible set (`computeReadLaterPreview` in `app/components/ReadLaterSection.tsx`), so dismissing a previewed item backfills the next hidden item and updates the badge immediately.
- [x] **Guarantee the background loop actually runs in production.** Fixed in code, not ops: FlowDesk runs on Railway as a single `next start` process with nothing external ever configured to call the `/api/cron/*` routes — the "Ops checklist" below was a standing gap, not a hypothetical. Added an in-process scheduler (`lib/scheduler/`) that boots via Next.js's `instrumentation.ts` hook and calls each job's underlying function directly (`setInterval`, no HTTP round-trip, no `CRON_SECRET` dependency) on its own interval — see `docs/CURRENT_STATE.md` for the full writeup. The `/api/cron/*` routes are unchanged and still work for manual/external triggering; they're just no longer the only thing that can make these jobs run.

### Ops checklist — superseded by the in-process scheduler above

Kept for reference / as a fallback interface, not because anything still needs scheduling externally:

- [x] ~~Schedule `GET /api/cron/agent-jobs`~~ — now runs every minute in-process.
- [x] ~~Schedule `GET /api/cron/gmail-writeback`~~ — now runs every minute in-process.
- [x] ~~Schedule `GET /api/cron/follow-up`~~ — now runs every 30 minutes in-process.
- [x] ~~Schedule `GET /api/cron/gmail-label-reconcile`~~ — now runs every 6 hours in-process.

## Phase 2 — MVP: first-run organize moment + speed — current focus

The core loop only acts on *new* mail today, so a new user connects Gmail and sees an unchanged inbox. This phase closes that gap and makes the loop fast. See `docs/flowdesk-vs-reference-gap-analysis.md` → "Top MVP gap" for the Inbox Zero comparison.

- [ ] **Retroactive first-pass on connect (flagship).** On Gmail connect, sync a bounded batch of existing inbox threads, run the deterministic classifier over them, and project labels (label-only, no archive) — so the user's real inbox visibly organizes in the first session. Reuse `reconcileGmailLabelsForChannel` / the `/api/connectors/gmail/relabel` machinery. Deterministic = zero LLM cost, so we can go deeper than Inbox Zero's 20-message LLM pass.
- [ ] **Proof screen.** After the first-pass, show "here's what we just organized" — the labeled + autodrafted threads, read from existing audit-log rows — before dropping the user into the dashboard.
- [ ] **Performance + correctness pass on hot paths** (from the 2026-07-08 perf audit): parallelize the ~6 serialized home-page DB round-trips into one `Promise.all`; wrap the command-center fetch in `unstable_cache` like `AppListColumn` already does; fix the latest-message correctness bug (home over-fetches the *oldest* 5 messages then picks newest among them — wrong for threads >5 messages; switch to `orderBy: desc` and stop loading full bodies for list rows); add `@@index([tenantId, status, lastMessageAt])`; guard the write-on-read (`isRead: false`) that rewrites every message row on each thread open; parallelize the conversation-page query groups.
- [ ] **Tighten the default path.** Remove the dead `/digest` route from nav (it's a bare `redirect("/inbox")`). Confirm nothing half-built is reachable from the default (non-Sales-CRM) navigation.

## Phase 3 — Web-app polish (after MVP)

Take layout and interaction cues from Inbox Zero, Tom Shaw's AI agent inbox, and the other references (`docs/reference-research/`).

- [ ] Split the oversized settings page into focused, navigable sections/tabs — shipped: a sticky section index with anchors for Connect, Gmail behavior, Automation, Training, Profile, and Data, and every one of the 16 panels is now grouped under its matching anchor (`SettingsSectionGroup`) so the nav actually reaches all of them, not just the first panel per bucket. Still needs true route/tab decomposition so heavy panels are not all loaded at once (Inbox Zero's own settings page keeps everything on one route too — the win here is data-fetching per section via client hooks, not URL splitting).
- [ ] Rebuild the dashboard/inbox shell and navigation so the secondary surface is clean and coherent (Inbox-Zero-style layout) — shipped: the home view's `HomeCommandCenter` went from 3 top-level headers plus 2 differently-styled ad-hoc sub-headings down to 2 consistently-accented pillars ("What needs you" / "The agent") with a single neutral `SubHeading` style. The desktop nav rail (`AppRail`) went from 8 icons to 6: removed the standalone `/search` page (its message-body search is now built into Home's existing search box, so nothing was lost — `/search` redirects to `/inbox` preserving the query) and demoted Activity from a permanent rail icon to a "Full activity log →" link inside Home's "What it did" section. The automation-level status line in `ControlRoomHeader` is now a link to `/settings#automation`, surfacing the single most important trust setting directly from Home instead of requiring a trip through Settings. Mobile's separate header nav (`lib/app-navigation.ts`, `Digest`/`Tasks`/`Settings`/More) is untouched — it's a different surface from the desktop rail and wasn't part of the reported complaint.
- [ ] Update remaining dashboard/settings copy so the web app reads as an intentional companion product.

## Phase 4 — Capability parity from the reference repos (after MVP)

Close the gap with the projects we studied (`docs/flowdesk-vs-reference-gap-analysis.md`). Copy code where it helps. Re-enable deferred surfaces one at a time as each reaches a real quality bar.

- [ ] Deepen bulk unsubscribe / cleanup (future-filter creation, open-rate signals) — the sender-grouped cleanup foundation exists.
- [ ] Smart categories and richer triage surfacing (evidence, confidence, correction history).
- [ ] Reply-tracking UX: nudge drafts, waiting-on analytics, evidence display.
- [ ] Rule authoring polish: structured-rule conflict detection, rule-aware approvals ("one-off vs teach a rule").
- [ ] Persist command-center snapshots for history and explainability.
- [ ] Finish heuristic consolidation: the `{"quiet","fyi_done"}` attention set is duplicated across command-center, inbox-fyi, gmail-labels, and workflow-status, and the isIgnorable/isFyi logic is implemented independently in command-center and inbox-fyi — extract shared sets plus a single helper.

## Finish existing foundations

- [ ] Complete scheduling confirmation and event booking.
- [ ] Add a workflow-template builder.
- [ ] Inject connected Google Drive context into draft generation.
- [ ] Add semantic knowledge/search retrieval and scheduled website recrawling.
- [ ] Make lead-sequence timing configurable and visible.
- [ ] Add user-visible AI budget/usage visibility for inbox chat and agent-rule compilation.

## Later / de-scoped (until Phases 1–2 land)

Deliberately parked so they don't distract from the core loop and polish:

- [ ] Record Outlook renewal/sync failure causes (`OutlookCredential.subscriptionError`, `OutlookSyncEvent.lastError`, audit) instead of bare catch blocks, and stop adding failed channels to `processedChannels`.
- [ ] Decide and implement Outlook archive/trash/unsubscribe parity.
- [ ] Implement CC/BCC send support and re-enable the compose fields once the APIs persist those recipients end-to-end.
- [ ] Broaden Gmail inline `cid:` image support beyond the current size-capped path; optionally backfill older messages.
- [ ] Gmail add-on / Chrome extension (waits until the Gmail-native core loop is validated).
- [ ] Design the team/shared-inbox data and permission model.
- [ ] Enforce packaging/plan tiers in code.
- [ ] Document customer-facing privacy, retention, security, and audit posture.
- [ ] `/digest` (mobile header nav) is a bare `redirect("/inbox")` with no content of its own — either build a real daily-digest view or drop it from `lib/app-navigation.ts`'s mobile nav.

## Recently shipped

Condensed history (full detail in Git log and `docs/CURRENT_STATE.md`):

- In-process background job scheduler (`lib/scheduler/`): the biggest single gap toward a working MVP. All 13 `/api/cron/*` routes existed but nothing in the deployment (Railway, single `next start` process, no external cron service configured) ever called them — the classification pipeline, Gmail writeback retries, label/state reconciliation, follow-ups, snooze resurfacing, workflow runs, lead sequences, and Outlook sync were all silently dead in production; inline draining (added earlier) covered the common case but not retries or drift correction. Extracted each route's inline business logic into an importable `lib/` function (7 routes had logic inline; 6 already delegated to one), then added a registry-driven scheduler that boots once via Next.js's `instrumentation.ts` hook and calls each function directly on its own interval (1 min for classification/writeback, 5–30 min for retries/drift/workflows, 6–24h for maintenance) — no HTTP round-trip, no `CRON_SECRET` dependency, so a misconfigured secret can no longer silently block everything. Overlap-guarded per job (a slow run skips its next tick rather than double-processing) and failure-isolated (one job throwing never stops another or crashes the interval). Status tracked via a `globalThis`-backed singleton (Next.js can instantiate a module more than once per process — the same reason `lib/prisma.ts` uses `global.prisma` — so a plain module-level variable silently failed to share state between `instrumentation.ts` and the route that reads it; caught live during verification, not by the test suite, and fixed the same way) and exposed at `GET /api/admin/scheduler-status` (`CRON_SECRET`-gated). The `/api/cron/*` HTTP routes are unchanged and still work for manual triggering. Verified live against a `next start` production build (not just `next dev`): the two `runOnStart` jobs (agent-jobs, gmail-writeback) ran automatically and successfully against the real database within seconds of boot, with no external caller involved.
- Fixed a real "labels are wrong, not just missing" bug found via live user testing: `projectFlowDeskLabelsForConversation` only read `attentionCategory`/`emailType` from the *persisted* `ConversationState`, which requires the AI classification job to have actually run. For a conversation it never ran for (the common case on an account that predates the classification pipeline, or where the job never executed), `deriveWorkflowStatus` fell through to a uniform "needs_reply" default — so newsletters, notifications, and already-handled mail all got labeled "Needs Reply" in Gmail even though the FlowDesk Inbox app itself showed them correctly (the app's dashboard uses richer, independently-computed signals the label path didn't have). Added a deterministic (no AI, no DB) `classifyEmailType` fallback for never-classified conversations. Verified live: a seeded newsletter with no `ConversationState` row now correctly queues "Read Later" instead of "Needs Reply". Also made the "Fix Gmail labels" button diagnose *why* nothing changed instead of a flat "already up to date" — it now surfaces the tenant's automation level and calls out explicitly when that's the actual blocker (queued=0 was previously indistinguishable between "genuinely nothing to fix" and "automation level silently blocked everything").
- Added a "Fix Gmail labels" self-service action (Settings → Gmail behavior) for accounts connected before the label reliability/color fixes existed. Their labels were frozen in whatever state the pipeline last successfully produced — "Sync now" doesn't help because it's an *incremental* Gmail sync that never revisits unchanged conversations, and the maintenance cron that would (`gmail-label-reconcile`) is cron-secret-only, not user-triggerable, and depends on cron infra being scheduled. The button calls the same reconcile logic (now shared via `lib/agent/gmail-label-reconcile.ts`) with a wider window/larger batch, recoloring the label set and re-queuing (and inline-draining) `apply_labels` writebacks for existing conversations — no reconnect or different Gmail account needed. Also fixed a latent bug found while extracting the shared logic: the cron pooled all tenants' conversations into one global batch of 50, so one very active tenant could starve everyone else's slice; now batched per channel.
- Fixed a first-run trust problem: a brand-new signup with zero Gmail accounts connected saw the control room confidently claim "FlowDesk is working in your Gmail" (false) with no clear next step. `buildControlRoomStatus` now returns an honest "Connect Gmail to get FlowDesk working" message and `ControlRoomHeader` shows a prominent "+ Connect Gmail" CTA (linking to the Connect section of Settings) in place of the automation-level status and the (previously hidden) Open Gmail button.
- Desktop nav rail simplified from 8 icons to 6 — removed the standalone `/search` page (its message-body search folded into Home's existing search box) and demoted Activity to a link inside Home's "What it did" section; the automation-level status is now a link to `/settings#automation`.
- Gmail label taxonomy redesign, inspired by Inbox Zero's `SystemType` categories: retired `Follow Up`/`Important`/`Low Priority` in favor of 4 content-type labels driven by the deterministic classifier's `emailType` — `Newsletter`, `Marketing`, `Notification` (also absorbs receipts/automated FYI mail), and a new `Calendar` type (meeting invites, `.ics`, Google/Zoom/Meet calendar senders). 10-label vocabulary total; classification stays deterministic, no LLM calls.
- Schema audit (prompted by "our data isn't handled correctly / too many tables"): the 45-model schema is mostly legitimately single-purpose (per-provider credential tables differ in real ways — Gmail's historyId/watch fields vs. Outlook's deltaLink/subscription fields aren't interchangeable — and most "job/run" tables track genuinely distinct concerns). No bulk consolidation done. Found and fixed one concrete, provable bug instead: `ConversationState.attentionCategory` (dedicated column, drives Gmail label projection via `lib/gmail-labels.ts`) is denormalized from `metadataJson.attentionCategory` (drives the in-app dashboard via `lib/agent/command-center.ts`) everywhere else in the codebase through a shared helper (`conversationStateMetadataData`) — except `lib/agent/automation-runner.ts`'s `update_attention` step (both forward execution and rollback), which wrote only the column. Any automation rule using that step type silently desynced Gmail from the app dashboard. Fixed to go through the same denormalization helper as every other write site. Not a "too many tables" problem — a missed-convention problem in one file.
- Synced the app's own inbox UI to the taxonomy above: it previously only exposed 4 coarse status filters (All/Needs Reply/Waiting/Done) with no way to see or filter by content type, so a conversation could be labeled `Newsletter` in Gmail while looking indistinguishable from any other email in FlowDesk itself. Added Newsletter/Marketing/Notification/Calendar filter pills and per-row content-type badges (desktop + mobile), and gave calendar emails their own bucket in the Home view's "quietly handled" breakdown instead of falling into `other`.
- Fixed the likely root cause of "labels created but nothing gets labeled in Gmail" and "some labels still have the FlowDesk/ prefix": label colors added in an earlier PR were bundled inline with create/rename/patch calls, so a single rejected color pair (Gmail's color API only accepts a fixed set of pairs) would throw and abort the whole labeling pipeline before it reached `threads.modify` — for every thread, from then on. Color-setting is now a separate best-effort call that can never block the label from existing or being applied, and the color values were replaced with Inbox Zero's verified-working palette.
- Home view consolidated from 3 top-level headers plus inconsistent ad-hoc sub-headings down to 2 accented pillars ("What needs you" / "The agent") with one consistent neutral sub-heading style throughout.
- Every settings panel grouped under its promised nav anchor (`SettingsSectionGroup`, styled after Inbox Zero's `SettingsGroup`) — previously only 6 of 16 panels were reachable from the sticky index.
- Bills & Deadlines dismiss and Read Later's "+N more" badge/backfill now update immediately instead of reappearing on refresh.
- Inline Gmail writeback draining and the command-center userState-first ordering fix (Phase 1 core loop).
- Flat Gmail label names — dropped the `FlowDesk/` namespace; legacy labels renamed in place (branch `feat/flat-gmail-labels`).
- B2C cleanup — dropped `Tenant.accountType`; `salesCrmEnabled` capability is the single source of truth.
- Sender-grouped Clean Inbox with real Gmail archiving + undo.
- "What FlowDesk did" per-conversation timeline + `/audit` "why" column.
- Static-first sender/domain/subject/body rules with dry-run preview, versioning, and execution metadata.
- Automation trust ladder (Level 0–5) gating labels / drafts / auto-send.
- Waiting-on / follow-up lifecycle with a Gmail-native `Waiting On` label (overdue tracking is app-only, no distinct Gmail label).
- Unified `ApprovalRequest` approval primitive; preserved user-edited `InboxTask` fields.
- Gmail writeback cron hardening (backoff, atomic claim, empty-set = remove-all).
- Gmail-native labels (Phase A) and drafts (Phase B) end-to-end.
