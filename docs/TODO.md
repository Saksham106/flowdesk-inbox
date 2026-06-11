# FlowDesk Remaining-Work To-Do List

Last updated: 2026-06-11

This is the canonical checklist of what has **not** been completed from the master product plan. It complements `MASTER_PRODUCT_PLAN.md` (the roadmap and feature index) and `CURRENT_STATE.md` (what exists). When work ships, check items off here and update both companion docs in the same branch.

Feature numbers reference the 45-feature brief in `MASTER_PRODUCT_PLAN.md`.

## Phase 1: "Never Drop The Ball" MVP — Remaining

Most Phase 1 foundations are shipped (command center, task/lead extraction, approval queue with bulk actions and draft preview, persisted person memory, follow-up tracker, safely-ignored view, due-date editing). What remains:

- [x] **Lead follow-up sequences** (#4) — shipped 2026-06-11: three-step sequence (first/second/closing follow-up) in `lib/agent/lead-sequence.ts`, cron at `/api/cron/lead-sequence`, sequence progress on `/leads`, jobs in the inbox follow-up tracker.
- [ ] **Weekly value report** (#32-lite) — `/reports` page aggregating replies drafted, tasks extracted, leads detected, follow-ups queued, and approvals processed from existing records. Only Phase 1 feature with zero implementation.
- [ ] **Explain This Thread Like I'm Busy** (#15) — LLM panel per thread: what happened, what they want, what you need to do, risks/deadlines, suggested reply.
- [ ] **Email Risk Radar** (#22) — dedicated view for deadline-tomorrow, final-notice, unanswered-N-days, and sensitive-content signals built on the state engine.
- [ ] **Auto-draft based on user intent** (#30) — messy instruction ("say yes but only next week") → polished reply compose flow.
- [ ] **Smart labels taxonomy** (#42) — replace limited labels with action-oriented set (needs decision, waiting on me, revenue opportunity, payment issue, urgent deadline, safe to ignore...).
- [ ] **Richer sensitive detection** (#10) — more categories (legal, immigration, tax, medical, HR, emotional) and highlighted risky parts inside drafts.
- [ ] **Command-center source signals** (#1) — meetings-needing-prep and bills/deadlines sections need calendar events and attachment/deadline signals.
- [ ] **Trust UX** (#44) — per-action "why" explanations and undo on top of the existing audit log.
- [ ] **Confidence policy thresholds** (#29) — confidence is displayed; policy gating by threshold per category is not implemented.
- [ ] **Task assignment and manual task creation** (#13).
- [ ] **Safely-ignored reasons and bulk archive** (#25).
- [ ] **Person-memory editing and corrections** (#5) — user-editable memory; LLM-based extraction upgrade.

## Phase 2: Business Revenue Inbox Agent — Not Started

- [ ] **Lead scoring refinement** (#7) — LLM-assisted scoring; budget/urgency extraction.
- [ ] **Mini CRM pipeline reporting** (#7) — stage funnel, value estimates.
- [ ] **Sales agent mode** (#20) — qualify, ask budget/timeline, suggest closing language.
- [ ] **Customer support agent mode** (#19) — FAQ answers, escalation, churn-risk detection, repeated-issue tracking.
- [ ] **Meeting prep from email history** (#11) — calendar event + thread + person memory → pre-meeting brief.
- [ ] **Post-meeting follow-up generator** (#12).
- [ ] **Email triage by money impact** (#40) — money-impact ranking in command center.
- [ ] **Full ROI analytics dashboard** (#32) — builds on the weekly value report.
- [ ] **Knowledge base source management** (#8) — website/page crawling, citations in drafts.
- [ ] **Local-business concierge templates** (#36).

## Phase 3: Personal Chief Of Staff — Not Started

- [ ] **Personal life admin mode** (#21) — bill/travel/school/medical/subscription detection.
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
