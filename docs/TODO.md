# Remaining Work

Last updated: 2026-07-06

## Near term

- [ ] Preserve user-edited `InboxTask` fields (due date, title) across work-item sync — the sync upsert currently overwrites them on the same deterministic key, violating the "user intent wins" invariant. Design decision: flip `source: "user"` on edit vs a `userEditedFields` metadata flag — match how `Lead` preserves `stage`/`score`.
- [ ] Unify draft approvals onto `ApprovalRequest` — today only meeting follow-up creates one; the primary draft flow runs entirely on `Draft.status`. Precondition for tiered approvals and the Phase D approval queue (audit §9 refactor-before-build).
- [x] Gmail writeback cron hardening (done with Phase C): exponential backoff + fail-out after max attempts, atomic pending → processing claim, and empty label sets now project as "remove all FlowDesk labels" for previously-labeled threads.
- [ ] Record Outlook renewal/sync failure causes (`OutlookCredential.subscriptionError`, `OutlookSyncEvent.lastError`, audit log) instead of bare catch blocks, and stop adding failed channels to `processedChannels` so the stale-mailbox fallback doesn't skip them.
- [ ] Fix `FlowDesk/Handle First` label mapping — `handle_first` is not an attention category the classifier or corrections can produce; map it from the command-center top-action selection or drop it from the vocabulary.
- [ ] Implement or remove the `create_draft` automation step type — declared in the step union but falls through to "Unknown step type" at runtime.
- [ ] Schedule FlowDesk Gmail label bootstrap as recurring maintenance (bootstrap on OAuth connect and manual sync is done).
- [ ] Add automation level settings for Gmail-native actions before expanding auto-read/archive/send behavior.
- [x] Track sent threads waiting for replies and apply `Waiting On` / `Follow Up` Gmail labels (Phase C: deterministic expects-reply detection on FlowDesk and Gmail-native sends, self-healing on inbound reply, follow-up-due label after the tenant's business-day delay, dashboard due dates).
- [ ] Update dashboard/settings copy and indicators so the website reads as the agent control room.
- [ ] Finish heuristic consolidation: the `{"quiet","fyi_done"}` attention set is duplicated across command-center, inbox-fyi, gmail-labels, and workflow-status, and the isIgnorable/isFyi decision logic is implemented independently in command-center and inbox-fyi — extract shared sets plus a single helper (regex constants are already shared via `lib/inbox-fyi.ts`).
- [ ] Persist command-center snapshots for history and explainability.
- [ ] Show classification source, confidence, evidence, and correction history.
- [ ] Add manual sender/domain rule creation, editing, and conflict handling.
- [ ] Decide and implement Outlook archive/trash/unsubscribe parity.
- [ ] Implement CC/BCC send support and re-enable compose fields once the APIs persist those recipients end-to-end.
- [ ] Broaden Gmail inline `cid:` image support beyond the current size-capped safe embedding path; optionally backfill messages synced before the fix landed.

## Ops checklist

Deployment/scheduling tasks (human, not code):

- [ ] Schedule the executor cron in production: `GET /api/cron/agent-jobs` with `Authorization: Bearer <CRON_SECRET>` — same scheduler setup as the gmail/outlook crons (README scheduled-endpoints section). Until this runs, the AgentJob pipeline (audit P1-1) is still dead in prod. After enabling: the stale backlog bulk-fails 200/run, response JSON should show real numbers, `X-Agent-Jobs-Errors` should stay quiet; check the audit log after a day.
- [ ] Confirm the `gmail-writeback` cron is scheduled too — Phase A/B label projection and native drafts do nothing without it.
- [ ] Confirm the `follow-up` cron (`GET /api/cron/follow-up`) is scheduled — Phase C's Follow Up label sweep runs there, and nothing else re-projects labels as time passes.

## Finish existing foundations

- [ ] Complete scheduling confirmation and event booking.
- [ ] Add a workflow-template builder.
- [ ] Inject connected Google Drive context into draft generation.
- [ ] Add semantic knowledge/search retrieval and scheduled website recrawling.
- [ ] Make lead-sequence timing configurable and visible.
- [ ] Add user-visible AI budget/usage visibility for inbox chat and agent-rule compilation.

## Later

- [ ] Design the team/shared-inbox data and permission model.
- [ ] Enforce free, personal, business, and team packaging in code.
- [ ] Document customer-facing privacy, retention, security, and audit posture.
