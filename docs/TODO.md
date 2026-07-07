# Remaining Work

Last updated: 2026-07-07

Coordination rule: before starting a roadmap lane, fetch `origin/main`, branch from the latest main in a fresh worktree, and claim the active item here or in the PR description. Clear the claim when the PR merges or is abandoned so duplicate Codex branches do not linger.

## Near term

- [x] Preserve user-edited `InboxTask` fields across work-item sync — done: user edits record the field in `metadataJson.userEditedFields` and flip `source: "user"`; the sync update branch skips user-owned fields (`lib/agent/user-edited-fields.ts`). Label projection now also honors a manual workflow choice (`conversation.userState`).
- [x] Unify draft approvals onto `ApprovalRequest` — done: all draft-propose paths create a pending request, approve/send/clear/autopilot resolve it, and /approvals decisions project onto `Draft.status` (`lib/agent/approvals.ts`).
- [x] Gmail writeback cron hardening (done with Phase C): exponential backoff + fail-out after max attempts, atomic pending → processing claim, and empty label sets now project as "remove all FlowDesk labels" for previously-labeled threads.
- [ ] Record Outlook renewal/sync failure causes (`OutlookCredential.subscriptionError`, `OutlookSyncEvent.lastError`, audit log) instead of bare catch blocks, and stop adding failed channels to `processedChannels` so the stale-mailbox fallback doesn't skip them.
- [x] Fix `FlowDesk/Handle First` label mapping — resolved by removing the label from the canonical vocabulary: `handle_first` is not producible by any classifier, rule, or correction, and the dashboard's Handle First ranking is relative/per-request, so it is not a stable per-thread Gmail label.
- [ ] Implement or remove the `create_draft` automation step type — declared in the step union but falls through to "Unknown step type" at runtime.
- [x] Schedule FlowDesk Gmail label bootstrap as recurring maintenance — done: `GET /api/cron/gmail-label-reconcile` ensures labels per Gmail channel and re-projects a bounded batch of recently-active conversations (scheduling it in production is in the Ops checklist).
- [x] Add automation level settings for Gmail-native actions — done: per-tenant Level 0–5 trust ladder (`lib/agent/automation-level.ts`) gates label projection (≥2), Gmail drafts (≥3), and auto-send (5), with a confirm-to-change settings selector. Auto mark-read/archive (Level 4) is gated but has no automatic callers yet.
- [x] Drop deprecated `Tenant.accountType` storage — done: `Tenant.salesCrmEnabled` is the only persisted capability flag; the old `accountType` column and `AccountType` enum were removed by migration. Remaining `accountType` names are internal derived prompt/UI mode plumbing returned by `accountModeFor`.
- [x] Track sent threads waiting for replies and apply `Waiting On` / `Follow Up` Gmail labels (Phase C: deterministic expects-reply detection on FlowDesk and Gmail-native sends, self-healing on inbound reply, follow-up-due label after the tenant's business-day delay, dashboard due dates).
- [ ] Update dashboard/settings copy and indicators so the website reads as the agent control room.
- [ ] Finish heuristic consolidation: the `{"quiet","fyi_done"}` attention set is duplicated across command-center, inbox-fyi, gmail-labels, and workflow-status, and the isIgnorable/isFyi decision logic is implemented independently in command-center and inbox-fyi — extract shared sets plus a single helper (regex constants are already shared via `lib/inbox-fyi.ts`).
- [ ] Persist command-center snapshots for history and explainability.
- [ ] Show classification source, confidence, evidence, and correction history.
- [x] Add manual sender/domain rule creation and editing — done (Gmail-native Phase 2 P0): static sender/domain/subject/body rules with zero-mutation dry-run preview (`POST /api/agent-rules/dry-run`), preview-before-enable gating, versioning via `agent_rule.version_snapshot` AuditLog snapshots, and execution metadata recording which rule version fired. Static rules evaluate before any LLM classification (`lib/agent/static-rules.ts`, gate in `lib/agent/classify.ts`/`lib/agent/jobs.ts`) with no AI budget spend on a match. Remaining: conflict detection for structured rules (the plain-English preview already has it).
- [x] Show "why this automation fired" in the control room UI — done: a per-conversation **"What FlowDesk did"** timeline (`lib/agent/conversation-timeline.ts`, pure/testable like command-center; rendered by `app/conversations/[id]/ConversationTimeline.tsx`) reads the thread's audit rows (`payloadJson.conversationId`) and surfaces each action with its "why" — static rule id/version/evidence, AI confidence, or the acting user. The global `/audit` page now also lists the writeback/label/waiting-on/automation-level actions and renders the rule/AI "why" in its Why column. Remaining: draft-source/prompt-input evidence on the draft panel (P1 draft learning).
- [ ] Decide and implement Outlook archive/trash/unsubscribe parity.
- [ ] Implement CC/BCC send support and re-enable compose fields once the APIs persist those recipients end-to-end.
- [ ] Broaden Gmail inline `cid:` image support beyond the current size-capped safe embedding path; optionally backfill messages synced before the fix landed.

## Ops checklist

Deployment/scheduling tasks (human, not code):

- [ ] Schedule the executor cron in production: `GET /api/cron/agent-jobs` with `Authorization: Bearer <CRON_SECRET>` — same scheduler setup as the gmail/outlook crons (README scheduled-endpoints section). Until this runs, the AgentJob pipeline (audit P1-1) is still dead in prod. After enabling: the stale backlog bulk-fails 200/run, response JSON should show real numbers, `X-Agent-Jobs-Errors` should stay quiet; check the audit log after a day.
- [ ] Confirm the `gmail-writeback` cron is scheduled too — Phase A/B label projection and native drafts do nothing without it.
- [ ] Confirm the `follow-up` cron (`GET /api/cron/follow-up`) is scheduled — Phase C's Follow Up label sweep runs there, and nothing else re-projects labels as time passes.
- [ ] Schedule `GET /api/cron/gmail-label-reconcile` (daily) with `Authorization: Bearer <CRON_SECRET>` — recreates deleted FlowDesk labels and re-projects drifted labels for recently-active conversations (README scheduled-endpoints section).

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
