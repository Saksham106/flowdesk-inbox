# FlowDesk Remaining Work

Last updated: 2026-06-17 (Phase 3 shipped in PR #61)

This is the actionable checklist of work that is still unfinished. Shipped history belongs in `CURRENT_STATE.md`, `MASTER_PRODUCT_PLAN.md`, or `docs/archive/`, not here.

Feature numbers reference the 45-feature index in `MASTER_PRODUCT_PLAN.md`.

## Near-Term Product Hardening

- [ ] **Persist command-center snapshots** (#1/#6) — reduce recomputation, preserve explainability, and make daily state auditable over time.
- [ ] **Classification explainability** (#42/#44) — expose why a thread received its attention category, including rule/AI/user source and correction history.
- [ ] **Preference-learning controls** (#27/#42) — add manual rule creation/editing and conflict handling for sender/domain rules.
- [ ] **Gmail archive follow-through** (#24/#25/#41) — add bulk archive/clean-inbox workflows and decide whether Outlook needs equivalent provider writeback.
- [ ] **Reply composer CC/BCC send support** (#3/#30) — UI captures CC/BCC, but send APIs still need to forward those fields.

## Phase 3: Personal Chief Of Staff ✅ Shipped (PR #61, 2026-06-17)

- [x] **Personal life admin mode** (#21) — classifier detects bills, travel, medical, subscriptions, school; "Life Admin" inbox tab; InboxTask creation for actionable types.
- [x] **VIP protection** (#33) — VipContact model, CRUD API, detector sets urgent priority, ⭐ badge in inbox + banner on conversation page, settings form.
- [x] **Reply later / smart snooze intelligence** (#34) — SnoozeReminder model, POST/DELETE API, hourly cron, SnoozeModal with presets, "Snoozed" inbox tab, resurfaced-from-snooze banner.
- [x] **Smart attachment intelligence** (#16) — EmailAttachment model, MIME parser, PDF text extraction via pdf-parse, fire-and-forget sync pipeline.
- [x] **Natural-language search** (#17) — Message.searchVector tsvector + GIN index + trigger; /search page; /api/search route; AppRail icon.
- [x] **Ask My Inbox chat** (#43) — OpenAI streaming RAG pipeline; /chat page; /api/chat SSE route; AppRail icon.
- [x] **Second-brain retrieval** (#38) — PersonMemory.factsJson, fact extractor (birthday/dietary/role/phone), SecondBrainPanel on conversation page.
- [x] **Phishing/scam/fraud protection** (#23) — signal-scored classifier; 🛡 warning banner; mark-safe flow; /api/conversations/[id]/phishing-safe.
- [x] **Auto-unsubscribe and noise killer** (#24) — detects List-Unsubscribe headers + body links; "Unsubscribe & Archive" button; fires HTTP GET, closes conversation, audit log.

## Phase 4: Automations And Integrations ✅ Shipped (PR #62, 2026-06-18)

- [x] **Outcome-based automation** (#26) — AutomationRun trace model, step executor, rollback API, conversation history panel.
- [x] **Train My Agent with plain English** (#27) — AgentRule model, NL compiler, preview endpoint, conflict detection, settings UI.
- [x] **Multi-step email workflows** (#31) — WorkflowTemplate + WorkflowRun models, workflow runner, cron job, seeded default workflows, settings panel.
- [x] **Category-scoped autopilot policy builder** (#2) — per-attention-category policy table (auto-send / require approval / never) in autopilot settings.
- [x] **Full scheduling back-and-forth** (#14) — first slice: scheduling detection + slot proposal; confirmation and calendar booking deferred.
- [x] **Context from connected apps** (#35) — GoogleDriveCredential model, Drive OAuth connect/disconnect, context search lib, ConnectedApps settings section.
- [x] **Auto-generated snippets and playbooks** (#37) — Snippet model, miner cron, snippets API, SnippetsPanel in settings, snippet picker in reply composer.
- [x] **Auto-personalized outreach** (#39) — deferred; avoid spam positioning.
- [x] **One-click Clean My Inbox onboarding** (#41) — /clean-inbox page, batch archive/unsubscribe routes, 1-hour undo via AuditLog, AppRail icon.

## Phase 5: Team Inbox Platform

- [ ] **Team model and shared inboxes** (#18) — assignments, comments, collision detection, shared snippets/KB, roles, SLA tracking, and team analytics.

## Cross-Cutting

- [ ] **Paid packaging enforcement** (#45) — free/pro/business/team gates are positioned but not enforced in code.
- [ ] **Privacy/security positioning** — retention, data handling, audit story, and buyer-facing security posture.
