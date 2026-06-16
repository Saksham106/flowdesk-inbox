# FlowDesk Remaining-Work To-Do List

Last updated: 2026-06-16 (attention persistence, email link reliability, expired Needs Action cleanup, dashboard dismissal)

This is the canonical checklist of what has **not** been completed from the master product plan. It complements `MASTER_PRODUCT_PLAN.md` (the roadmap and feature index) and `CURRENT_STATE.md` (what exists). When work ships, check items off here and update both companion docs in the same branch.

Feature numbers reference the 45-feature brief in `MASTER_PRODUCT_PLAN.md`.

## Phase 1: "Never Drop The Ball" MVP — Remaining

Most Phase 1 foundations are shipped (command center, task/lead extraction, approval queue with bulk actions and draft preview, persisted person memory, follow-up tracker, safely-ignored view, due-date editing). What remains:

- [x] **Lead follow-up sequences** (#4) — shipped 2026-06-11: three-step sequence (first/second/closing follow-up) in `lib/agent/lead-sequence.ts`, cron at `/api/cron/lead-sequence`, sequence progress on `/leads`, jobs in the inbox follow-up tracker.
- [x] **Weekly value report** (#32-lite) — shipped 2026-06-11: `/reports` page with rolling 7-day metrics (drafts, sends, tasks, leads, follow-ups, approvals, triage) and a conservative time-saved estimate, computed in `lib/agent/value-report.ts` from existing records.
- [x] **Explain This Thread Like I'm Busy** (#15) — shipped 2026-06-11: on-demand LLM panel on conversation pages (what happened, what they want, what to do, risks with risk badge, suggested next step) via `POST /api/conversations/[id]/explain`; audited and usage-tracked.
- [x] **Email Risk Radar** (#22) — shipped 2026-06-12: `/risk-radar` read-only view with deadline-soon, final-notice, unanswered-N-days, and sensitive-content signal groups built on `lib/agent/risk-radar.ts`.
- [x] **Auto-draft based on user intent** (#30) — shipped 2026-06-12: AI draft panel accepts an optional rough instruction ("say yes but only next week"), passes it into draft generation, and records it in draft metadata while preserving approval-gated sending.
- [x] **Smart labels taxonomy — first attention slice** (#42) — shipped 2026-06-14: deterministic and LLM classification now support `needs_reply`, `needs_action`, `review_soon`, `read_later`, `waiting_on`, `fyi_done`, and `quiet`; stored in `ConversationState.metadataJson.attentionCategory`.
- [x] **Account-action detection slice** (#21/#42) — shipped 2026-06-15: deterministic OTP, verify-email, password setup/reset, login approval, account setup, and security alert detection; redacted action metadata is surfaced to Home cards without persisting OTP codes.
- [x] **Read/done sync persistence hardening** (#6/#42) — shipped 2026-06-15: local user overrides and read state are separate from raw Gmail state; Gmail sync no longer resurrects done items in Handle First.
- [x] **Smart labels taxonomy — product-complete UI** (#42) — shipped 2026-06-15 and hardened 2026-06-16: attention filter tabs (Reply/Review/Later) in inbox, `AttentionCorrectionSelect` dropdown on conversation pages, persisted `PATCH /api/conversations/[id]/attention` user overrides, bulk-close workflow for quiet/fyi_done categories. Action metadata badges (OTP, password reset, security alert, expiry warnings, action links) surfaced on Home cards. Expired action items now leave Needs Action automatically; Needs Action cards have a persisted "Not needed" dismissal.
- [x] **Richer sensitive detection** (#10) — shipped 2026-06-15: expanded classifier to legal, immigration, tax, medical, HR, emotional categories; highlighted risky snippet in AI draft panel.
- [x] **Command-center source signals** (#1) — shipped 2026-06-15 and hardened 2026-06-16: Bills & Deadlines section in home command center powered by `buildBillsSection` from `lib/agent/command-center.ts`, driven by `InboxTask.dueAt` signals sorted ascending. Expired security/reset action alerts are filtered out so stale items do not linger as current deadlines.
- [x] **Trust UX** (#44) — shipped 2026-06-15: "Why" column with audit log explanations and "Undo" button on `/audit`; `POST /api/audit/[id]/undo` reverts autopilot draft approvals with tenant isolation + re-audit.
- [x] **Confidence policy thresholds** (#29) — shipped 2026-06-15: `AutopilotSetting.categoryThresholdsJson` schema field; per-category threshold gate in `lib/agent/autopilot.ts` with case-insensitive intent lookup; settings UI in `/settings`; server-side validation [0.5, 1.0].
- [x] **Task assignment and manual task creation** (#13) — shipped 2026-06-15: `POST /api/tasks` with `source: "manual"`, `ManualTaskForm` and `WorkItemsPanel` with "+ Add task" toggle on conversation pages.
- [x] **Safely-ignored reasons and bulk archive** (#25) — shipped 2026-06-15: `BulkCloseButton` on `/inbox`, `POST /api/conversations/bulk-close` closes all quiet/fyi_done/fyi_only conversations; attention tabs surface safely-ignored threads.
- [x] **Person-memory editing and corrections** (#5) — shipped 2026-06-15: `PersonMemoryEditShell`/`PersonMemoryEditPanel` client forms; `PATCH /api/person-memory/[contactId]` partial-update route; `syncPersonMemoryWithLLM` LLM extraction upgrade with `gpt-5.4-mini` fallback to heuristic.

## Phase 2: Business Revenue Inbox Agent

- [x] **Meeting prep from email history** (#11) — shipped 2026-06-11: `/meetings` page with on-demand brief from PersonMemory + email threads; digest shows today's meetings.
- [x] **Post-meeting follow-up generator** (#12) — shipped 2026-06-11: notes + prior threads → follow-up draft → ApprovalRequest; falls back to inline copy.
- [x] **Lead scoring refinement** (#7) — shipped 2026-06-11: LLM-based scorer replacing heuristic; `scoreExplanation`, `estimatedValue`, `scoredAt` fields; fire-and-forget sync integration; on-demand re-score API + RescoreButton; funnel header + color-coded score badge on `/leads`; command center opportunity cards use LLM explanation.
- [x] **Mini CRM pipeline reporting** (#7) — shipped 2026-06-12: score/stage filters, week-over-week stats table, and pipeline funnel summary on `/leads`.
- [x] **Sales agent mode** (#20) — shipped 2026-06-12: regex-based `classifySalesSignals` in work-item-sync, `SalesPanel` on conversation pages, `?sales=1` filter tab in inbox, Sales Qualified count chip in command center.
- [x] **Customer support agent mode** (#19) — shipped 2026-06-12: `classifySupportSignals` in work-item-sync, SupportPanel on conversation pages, support filter in inbox, support count in command center.
- [x] **Email triage by money impact** (#40) — shipped 2026-06-13: revenue-weighted `score()` bonus (+up to 50) in command center, Revenue at Risk subsection (amber cards for stale high-value leads) in `CommandCenterPanel`, `analyzeRevenueAtRisk` in `lib/agent/revenue-at-risk.ts`.
- [x] **Full ROI analytics dashboard** (#32) — shipped 2026-06-13: `ValueSnapshot` model, weekly cron at `/api/cron/value-snapshot`, `buildValueSnapshot`/`getWeeklyTrend` in `value-report.ts`, 4-week trend bars + pipeline value summary + revenue opportunities on `/reports`.
- [x] **Knowledge base source management** (#8) — shipped 2026-06-12: URL crawl endpoint, `sourceUrl`/`crawledAt` fields, `/knowledge-base` page, `"webpage"` source type, citations in draft replies.
- [x] **Local-business concierge templates** (#36) — shipped 2026-06-15: 8 templates across 6 categories in `lib/agent/concierge-templates.ts`; `POST /api/settings/seed-templates` idempotent seed route (business-only); template picker in `ReplyComposer`; templates excluded from AI reply context via `sourceType: "concierge_template"` filter.

## Phase 3: Personal Chief Of Staff — Not Started

- [ ] **Personal life admin mode** (#21) — first attention rules now catch codes, account setup, security, billing, delivery, calendar RSVP, and common account-action links; expired OTP/reset/security actions are auto-downgraded and can be manually dismissed. Still needs broader bill/travel/school/medical/subscription flows and privacy UX.
- [ ] **VIP protection** (#33).
- [ ] **Reply later / smart snooze intelligence** (#34).
- [ ] **Smart attachment intelligence** (#16) — PDF/invoice/contract extraction.
- [ ] **Natural-language search** (#17).
- [ ] **Ask My Inbox chat** (#43).
- [ ] **Second-brain retrieval** (#38).
- [ ] **Phishing/scam/fraud protection** (#23) — discovery needed first.
- [ ] **Auto-unsubscribe and noise killer** (#24).

## Phase 4: Automations And Integrations — Not Started

- [ ] **Outcome-based automation** (#26) — discovery.
- [ ] **Train My Agent with plain English** (#27) — discovery; needs `AgentRule` compiler.
- [ ] **Multi-step email workflows** (#31) — discovery; needs `AutomationRun` trace model.
- [ ] **Category-scoped autopilot policy builder** (#2).
- [ ] **Full scheduling back-and-forth** (#14).
- [ ] **Context from connected apps** (#35) — discovery.
- [ ] **Auto-generated snippets and playbooks** (#37).
- [ ] **Auto-personalized outreach** (#39) — later.
- [ ] **One-click Clean My Inbox onboarding** (#41).

## Phase 5: Team Inbox Platform — Not Started

- [ ] **Team model, shared inboxes, assignments, comments, collision detection, shared snippets, team KB, roles/permissions, SLA tracking, team analytics** (#18).

## Cross-Cutting / Packaging

- [ ] **Paid packaging enforcement** (#45) — free/pro/business/team plan gates; packaging is documented but not enforced anywhere in code.
- [ ] **Privacy/security positioning** — data handling, retention, and audit story for business buyers.
