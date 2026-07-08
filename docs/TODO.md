# Remaining Work

Last updated: 2026-07-07

Reprioritized around the refocused product vision (`docs/product-direction.md` → Roadmap): **Gmail is the primary surface and must work really well; the web app is a polished secondary surface.** Order of work is **correctness → polish → capability**. Small correctness items and Outlook are de-scoped until Phases 1–2 land.

Coordination rule: before starting a lane, fetch `origin/main`, branch from the latest main in a fresh worktree, and claim the active item here or in the PR description. Clear the claim when the PR merges or is abandoned so duplicate branches do not linger.

## Phase 1 — Trustworthy core loop (P0, current focus)

The loop *classify → act in Gmail → reflect state truthfully in the UI* must be reliable before anything new ships. Root-cause detail for the first two items is in `docs/CURRENT_STATE.md` → "Known-broken".

- [ ] **Labels are created but never applied to threads.** Make label projection a reliable consequence of sync/classification — run it inline when a conversation is classified/updated, with the cron as backup — instead of silently depending on background crons. Verify end-to-end: label a thread in the app → the label is on the thread in Gmail. (`lib/gmail-labels.ts`, `lib/agent/work-item-sync.ts`, Gmail sync path.)
- [ ] **"Mark done" / state changes don't stick on refresh.** Make the explicit user decision (`userState`) the highest-priority signal in `analyzeConversationForCommandCenter` (`lib/agent/command-center.ts`) — it must win over draft-ready and re-classification — and have the home view trust persisted state instead of recomputing priority every render. Verify: mark done → refresh → still gone. Do the same audit for read / archive / waiting-on.
- [ ] **Guarantee the background loop actually runs.** The label/draft/follow-up pipelines are inert if their crons aren't scheduled (see Ops checklist). Confirm scheduling AND reduce the dependence on it for the critical path (inline projection above). Surface queue/cron health in the app so a stalled pipeline is impossible to miss.
- [ ] **Implement or remove the `create_draft` automation step type** — declared in the step union but falls through to "Unknown step type" at runtime. A half-wired action erodes trust.
- [ ] **End-to-end verification pass** on the Gmail core loop (labels, drafts, waiting-on) in the real app, not just unit tests, before declaring Phase 1 done.

### Ops checklist (human, not code — Phase 1 blocking)

These make the difference between "the pipeline works" and "the pipeline is dead in prod":

- [ ] Schedule `GET /api/cron/agent-jobs` (`Authorization: Bearer <CRON_SECRET>`). Until this runs, the AgentJob classification pipeline is dead — which is one cause of empty labels.
- [ ] Schedule `GET /api/cron/gmail-writeback` — label projection and native drafts do nothing without it.
- [ ] Schedule `GET /api/cron/follow-up` — the Follow Up label sweep runs there; nothing else re-projects labels as time passes.
- [ ] Schedule `GET /api/cron/gmail-label-reconcile` (daily) — recreates deleted labels and re-projects drifted labels for recently-active conversations.

## Phase 2 — Web-app polish (secondary surface, high quality bar)

Take layout and interaction cues from Inbox Zero, Tom Shaw's AI agent inbox, and the other references (`docs/reference-research/`).

- [ ] Split the oversized settings page into focused, navigable sections/tabs — first slice shipped a sticky section index with anchors for Connect, Gmail behavior, Automation, Training, Profile, and Data; still needs true route/tab decomposition so heavy panels are not all loaded at once.
- [ ] Rebuild the dashboard/inbox shell and navigation so the secondary surface is clean and coherent (Inbox-Zero-style layout).
- [ ] Fix the optimistic-dismiss surfaces that reappear on hard refresh (Bills & Deadlines, Read Later overflow count) so the UI never shows stale/contradictory state.
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

## Recently shipped

Condensed history (full detail in Git log and `docs/CURRENT_STATE.md`):

- Flat Gmail label names — dropped the `FlowDesk/` namespace; legacy labels renamed in place (branch `feat/flat-gmail-labels`).
- B2C cleanup — dropped `Tenant.accountType`; `salesCrmEnabled` capability is the single source of truth.
- Sender-grouped Clean Inbox with real Gmail archiving + undo.
- "What FlowDesk did" per-conversation timeline + `/audit` "why" column.
- Static-first sender/domain/subject/body rules with dry-run preview, versioning, and execution metadata.
- Automation trust ladder (Level 0–5) gating labels / drafts / auto-send.
- Waiting-on / follow-up lifecycle with Gmail-native `Waiting On` / `Follow Up` labels.
- Unified `ApprovalRequest` approval primitive; preserved user-edited `InboxTask` fields.
- Gmail writeback cron hardening (backoff, atomic claim, empty-set = remove-all).
- Gmail-native labels (Phase A) and drafts (Phase B) end-to-end.
