# FlowDesk Remaining Work

Last updated: 2026-06-18

This is the actionable checklist of work that is still unfinished. Shipped history belongs in `CURRENT_STATE.md`, `MASTER_PRODUCT_PLAN.md`, or `docs/archive/`, not here.

Feature numbers reference the 45-feature index in `MASTER_PRODUCT_PLAN.md`.

## Near-Term Product Hardening

- [ ] **Finish auto-email heuristic consolidation** — inbox list/mobile filtering now uses `lib/inbox-fyi.ts`; fold command-center auto-email logic into the same helper or shared classifier so dashboard and list behavior cannot drift again.
- [ ] **Persist command-center snapshots** (#1/#6) — reduce recomputation, preserve explainability, and make daily state auditable over time.
- [ ] **Classification explainability** (#42/#44) — expose why a thread received its attention category, including rule/AI/user source and correction history.
- [ ] **Preference-learning controls** (#27/#42) — add manual rule creation/editing and conflict handling for sender/domain rules.
- [ ] **Provider cleanup parity** (#24/#25/#41) — Gmail archive/trash and Clean Inbox exist; decide whether Outlook needs equivalent archive/trash/unsubscribe writeback.
- [ ] **Reply composer CC/BCC send support** (#3/#30) — UI captures CC/BCC, but send APIs still need to forward those fields.

## Phase 5: Team Inbox Platform

- [ ] **Team model and shared inboxes** (#18) — assignments, comments, collision detection, shared snippets/KB, roles, SLA tracking, and team analytics.

## Cross-Cutting

- [ ] **Paid packaging enforcement** (#45) — free/pro/business/team gates are positioned but not enforced in code.
- [ ] **Privacy/security positioning** — retention, data handling, audit story, and buyer-facing security posture.
