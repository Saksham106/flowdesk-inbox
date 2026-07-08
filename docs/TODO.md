# Remaining Work

Last updated: 2026-07-08 (Gmail label taxonomy redesign)

Reprioritized around the refocused product vision (`docs/product-direction.md` → Roadmap): **Gmail is the primary surface and must work really well; the web app is a polished secondary surface.** Order of work is **correctness → polish → capability**. Small correctness items and Outlook are de-scoped until Phases 1–2 land.

Coordination rule: before starting a lane, fetch `origin/main`, branch from the latest main in a fresh worktree, and claim the active item here or in the PR description. Clear the claim when the PR merges or is abandoned so duplicate branches do not linger.

## Phase 1 — Trustworthy core loop — shipped

The loop *classify → act in Gmail → reflect state truthfully in the UI* is now reliable. Detail in `docs/MASTER_PRODUCT_PLAN.md` decision log (2026-07-08 entries) and `docs/CURRENT_STATE.md`.

- [x] **Labels are created but never applied to threads** — fixed: `queueFlowDeskLabelWriteback` (`lib/gmail-labels.ts`) best-effort drains the job it just queued inline via `lib/agent/gmail-writeback-processor.ts`, instead of depending entirely on the `gmail-writeback` cron. The cron remains the retry backstop for whatever the inline attempt can't finish.
- [x] **"Mark done" / state changes don't stick on refresh** — fixed: `analyzeConversationForCommandCenter` (`lib/agent/command-center.ts`) checks the explicit user decision (`userState`) before any draft-ready/AI-derived signal, and `needsAction`/`readLater` are gated by `userState` too so a resolved conversation can't resurface in other dashboard sections. Verified live: a conversation marked done stays done even with a "proposed" draft and stale `needs_action` metadata reintroduced after the fact.
- [x] **Implement or remove the `create_draft` automation step type** — removed: it was unreachable dead code (no trigger/template ever constructed one); the working Gmail-native draft system is unrelated writeback lane.
- [x] **End-to-end verification pass** — done live against a running dev server + local Postgres for both the mark-done and label-writeback fixes.
- [x] **Task dismiss (Bills & Deadlines) reappearing on refresh** — fixed: `/api/tasks/[id]/status` now calls `revalidateInboxViews` (it never did before), matching the pattern the workflow-status route already used.
- [x] **Read Later "+N more" badge going stale after a dismiss** — fixed: preview/overflow are now computed from the currently-visible set (`computeReadLaterPreview` in `app/components/ReadLaterSection.tsx`), so dismissing a previewed item backfills the next hidden item and updates the badge immediately.
- [ ] **Guarantee the background loop actually runs in production.** Inline draining covers the common case, but confirm the crons below are actually scheduled so retries/backfills work too, and add queue/cron health visibility in the app.

### Ops checklist (human, not code — still open)

These make the difference between "the pipeline works" and "the pipeline is dead in prod":

- [ ] Schedule `GET /api/cron/agent-jobs` (`Authorization: Bearer <CRON_SECRET>`). Until this runs, the AgentJob classification pipeline is dead — which is one cause of empty labels.
- [ ] Schedule `GET /api/cron/gmail-writeback` — label projection and native drafts do nothing without it.
- [ ] Schedule `GET /api/cron/follow-up` — its label sweep re-projects overdue waiting-on conversations to catch drift; nothing else re-projects labels as time passes.
- [ ] Schedule `GET /api/cron/gmail-label-reconcile` (daily) — recreates deleted labels and re-projects drifted labels for recently-active conversations.

## Phase 2 — Web-app polish (secondary surface, high quality bar)

Take layout and interaction cues from Inbox Zero, Tom Shaw's AI agent inbox, and the other references (`docs/reference-research/`).

- [ ] Split the oversized settings page into focused, navigable sections/tabs — shipped: a sticky section index with anchors for Connect, Gmail behavior, Automation, Training, Profile, and Data, and every one of the 16 panels is now grouped under its matching anchor (`SettingsSectionGroup`) so the nav actually reaches all of them, not just the first panel per bucket. Still needs true route/tab decomposition so heavy panels are not all loaded at once (Inbox Zero's own settings page keeps everything on one route too — the win here is data-fetching per section via client hooks, not URL splitting).
- [ ] Rebuild the dashboard/inbox shell and navigation so the secondary surface is clean and coherent (Inbox-Zero-style layout) — shipped: the home view's `HomeCommandCenter` went from 3 top-level headers plus 2 differently-styled ad-hoc sub-headings down to 2 consistently-accented pillars ("What needs you" / "The agent") with a single neutral `SubHeading` style. The desktop nav rail (`AppRail`) went from 8 icons to 6: removed the standalone `/search` page (its message-body search is now built into Home's existing search box, so nothing was lost — `/search` redirects to `/inbox` preserving the query) and demoted Activity from a permanent rail icon to a "Full activity log →" link inside Home's "What it did" section. The automation-level status line in `ControlRoomHeader` is now a link to `/settings#automation`, surfacing the single most important trust setting directly from Home instead of requiring a trip through Settings. Mobile's separate header nav (`lib/app-navigation.ts`, `Digest`/`Tasks`/`Settings`/More) is untouched — it's a different surface from the desktop rail and wasn't part of the reported complaint.
- [ ] Update remaining dashboard/settings copy so the web app reads as an intentional companion product.

## Phase 3 — Capability parity from the reference repos

Close the gap with the projects we studied (`docs/flowdesk-vs-reference-gap-analysis.md`). Copy code where it helps.

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

- Fixed a real "labels are wrong, not just missing" bug found via live user testing: `projectFlowDeskLabelsForConversation` only read `attentionCategory`/`emailType` from the *persisted* `ConversationState`, which requires the AI classification job to have actually run. For a conversation it never ran for (the common case on an account that predates the classification pipeline, or where the job never executed), `deriveWorkflowStatus` fell through to a uniform "needs_reply" default — so newsletters, notifications, and already-handled mail all got labeled "Needs Reply" in Gmail even though the FlowDesk Inbox app itself showed them correctly (the app's dashboard uses richer, independently-computed signals the label path didn't have). Added a deterministic (no AI, no DB) `classifyEmailType` fallback for never-classified conversations. Verified live: a seeded newsletter with no `ConversationState` row now correctly queues "Read Later" instead of "Needs Reply". Also made the "Fix Gmail labels" button diagnose *why* nothing changed instead of a flat "already up to date" — it now surfaces the tenant's automation level and calls out explicitly when that's the actual blocker (queued=0 was previously indistinguishable between "genuinely nothing to fix" and "automation level silently blocked everything").
- Added a "Fix Gmail labels" self-service action (Settings → Gmail behavior) for accounts connected before the label reliability/color fixes existed. Their labels were frozen in whatever state the pipeline last successfully produced — "Sync now" doesn't help because it's an *incremental* Gmail sync that never revisits unchanged conversations, and the maintenance cron that would (`gmail-label-reconcile`) is cron-secret-only, not user-triggerable, and depends on cron infra being scheduled. The button calls the same reconcile logic (now shared via `lib/agent/gmail-label-reconcile.ts`) with a wider window/larger batch, recoloring the label set and re-queuing (and inline-draining) `apply_labels` writebacks for existing conversations — no reconnect or different Gmail account needed. Also fixed a latent bug found while extracting the shared logic: the cron pooled all tenants' conversations into one global batch of 50, so one very active tenant could starve everyone else's slice; now batched per channel.
- Fixed a first-run trust problem: a brand-new signup with zero Gmail accounts connected saw the control room confidently claim "FlowDesk is working in your Gmail" (false) with no clear next step. `buildControlRoomStatus` now returns an honest "Connect Gmail to get FlowDesk working" message and `ControlRoomHeader` shows a prominent "+ Connect Gmail" CTA (linking to the Connect section of Settings) in place of the automation-level status and the (previously hidden) Open Gmail button.
- Desktop nav rail simplified from 8 icons to 6 — removed the standalone `/search` page (its message-body search folded into Home's existing search box) and demoted Activity to a link inside Home's "What it did" section; the automation-level status is now a link to `/settings#automation`.
- Gmail label taxonomy redesign, inspired by Inbox Zero's `SystemType` categories: retired `Follow Up`/`Important`/`Low Priority` in favor of 4 content-type labels driven by the deterministic classifier's `emailType` — `Newsletter`, `Marketing`, `Notification` (also absorbs receipts/automated FYI mail), and a new `Calendar` type (meeting invites, `.ics`, Google/Zoom/Meet calendar senders). 10-label vocabulary total; classification stays deterministic, no LLM calls.
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
