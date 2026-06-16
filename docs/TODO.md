# FlowDesk Remaining Work

Last updated: 2026-06-16

This is the actionable checklist of work that is still unfinished. Shipped history belongs in `CURRENT_STATE.md`, `MASTER_PRODUCT_PLAN.md`, or `docs/archive/`, not here.

Feature numbers reference the 45-feature index in `MASTER_PRODUCT_PLAN.md`.

## Near-Term Product Hardening

- [ ] **Persist command-center snapshots** (#1/#6) — reduce recomputation, preserve explainability, and make daily state auditable over time.
- [ ] **Classification explainability** (#42/#44) — expose why a thread received its attention category, including rule/AI/user source and correction history.
- [ ] **Preference-learning controls** (#27/#42) — add manual rule creation/editing and conflict handling for sender/domain rules.
- [ ] **Gmail archive follow-through** (#24/#25/#41) — add bulk archive/clean-inbox workflows and decide whether Outlook needs equivalent provider writeback.
- [ ] **Reply composer CC/BCC send support** (#3/#30) — UI captures CC/BCC, but send APIs still need to forward those fields.

## Phase 3: Personal Chief Of Staff

- [ ] **Personal life admin mode** (#21) — broaden beyond OTP/security/billing/delivery/calendar signals into travel, school, medical, insurance, subscriptions, and privacy-first review UX.
- [ ] **VIP protection** (#33) — model VIP contacts and escalation rules.
- [ ] **Reply later / smart snooze intelligence** (#34) — reminder model, inbox surfacing, and safe follow-up timing.
- [ ] **Smart attachment intelligence** (#16) — ingest PDFs/images/attachments, extract deadlines/facts, and store auditable insights.
- [ ] **Natural-language search** (#17) — index conversations and return permission-scoped answers with citations.
- [ ] **Ask My Inbox chat** (#43) — action-oriented inbox Q&A, not just summaries.
- [ ] **Second-brain retrieval** (#38) — retrieval over memory, commitments, and historical threads.
- [ ] **Phishing/scam/fraud protection** (#23) — discovery first; needs conservative false-positive UX.
- [ ] **Auto-unsubscribe and noise killer** (#24) — safe unsubscribe/archive flows and undo.

## Phase 4: Automations And Integrations

- [ ] **Outcome-based automation** (#26) — trace model, approval gates, and rollback.
- [ ] **Train My Agent with plain English** (#27) — rule compiler, previews, conflict resolution, and test cases.
- [ ] **Multi-step email workflows** (#31) — workflow state, approvals, and audit timeline.
- [ ] **Category-scoped autopilot policy builder** (#2) — user-facing policy UI beyond threshold settings.
- [ ] **Full scheduling back-and-forth** (#14) — negotiate times and book calendar events safely.
- [ ] **Context from connected apps** (#35) — choose integrations by workflow, not logo count.
- [ ] **Auto-generated snippets and playbooks** (#37) — mine repeated patterns and require user approval.
- [ ] **Auto-personalized outreach** (#39) — later; avoid spam positioning.
- [ ] **One-click Clean My Inbox onboarding** (#41) — bulk actions, preview, and undo.

## Phase 5: Team Inbox Platform

- [ ] **Team model and shared inboxes** (#18) — assignments, comments, collision detection, shared snippets/KB, roles, SLA tracking, and team analytics.

## Cross-Cutting

- [ ] **Paid packaging enforcement** (#45) — free/pro/business/team gates are positioned but not enforced in code.
- [ ] **Privacy/security positioning** — retention, data handling, audit story, and buyer-facing security posture.
