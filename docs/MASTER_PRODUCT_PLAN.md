# FlowDesk Inbox Master Product Plan

Last updated: 2026-06-11

This is the living master plan for FlowDesk Inbox. It exists so humans and AI agents can share the same product map, update it as reality changes, and avoid treating one feature request as the whole product.

## How To Use This Plan

- Treat this as the product north star, not a locked sprint contract.
- Before starting a feature, check the feature index, current status, dependencies, and recommended next slice.
- When a feature ships, update its status, link its implementation plan, and note what changed.
- When a discovery changes priority, update the phase and explain why in the decision log.
- Keep implementation plans separate and detailed. This master doc should stay readable.
- AI agents must update this plan in the same branch as roadmap-affecting code changes.

Status legend:

- `Shipped`: implemented and verified.
- `Partial`: some behavior exists, but the feature is not product-complete.
- `Planned`: accepted for roadmap, no meaningful implementation yet.
- `Discovery`: needs product/technical validation before implementation.
- `Later`: valuable, but not near-term.

## AI Agent Operating Rules

Use this plan to decide what to build, but use `CURRENT_STATE.md` to verify what already exists. Do not assume a feature is missing just because it is not fully product-complete.

When an agent changes code:

1. Update feature status in the feature index if the change moves a feature from `Planned` to `Partial`, `Partial` to `Shipped`, or changes its phase.
2. Add links to new specs or implementation plans.
3. Add a decision-log row for significant scope changes, deprecations, or architecture choices.
4. Keep the immediate next-slice recommendation current.
5. Do not mark a feature `Shipped` unless tests/build or documented manual QA verify it.

## Product Thesis

FlowDesk should not be positioned as an AI email writer. The stronger promise is:

> FlowDesk is the AI chief of staff for your inbox. Every morning it tells you what matters, what can be ignored, who needs follow-up, where money or deadlines are at risk, and safely handles the boring work.

The product should consistently do five things:

1. Know what matters.
2. Know what can be ignored.
3. Know the relationship history.
4. Know the next action.
5. Do the boring work safely.

## Current Implementation Baseline

Existing foundations in the codebase:

- Gmail and Outlook connector surfaces.
- Google Calendar credential and calendar hold support.
- Conversations, messages, contacts, labels, and statuses.
- AI draft generation with knowledge documents and learned reply profiles.
- Approval requests and audit logs.
- Agent jobs, classification, follow-up batch jobs, autopilot settings.
- Business and personal profile settings.
- Daily command center first slice.

Recently shipped first slice:

- Design doc: `docs/superpowers/specs/2026-06-11-daily-command-center-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-11-daily-command-center.md`
- Core analyzer: `lib/agent/command-center.ts`
- Inbox command center: `app/inbox/CommandCenterPanel.tsx`
- Digest briefing: `app/digest/DailyBriefSections.tsx`
- Thread assistant context and "Handle this": `app/conversations/[id]/HandleThisPanel.tsx`

Task/lead/approval foundation slice:

- Design doc: `docs/superpowers/specs/2026-06-11-task-lead-approval-foundation-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-11-task-lead-approval-foundation.md`
- Extraction helpers: `lib/agent/work-items.ts`
- Persistence sync: `lib/agent/work-item-sync.ts`
- Approval queue: `app/approvals/page.tsx`
- Conversation work-items panel: `app/conversations/[id]/WorkItemsPanel.tsx`

## North Star User Experience

### Morning Brief

The first screen should say:

> Here are the 7 things that actually matter today.

It should show:

- Needs your reply.
- Waiting on someone else.
- Meetings that need prep.
- Bills, deadlines, forms, contracts.
- Opportunities, leads, and money.
- Potential problems.
- Things safely ignored.

### Thread View

Every thread should answer:

- What happened?
- What do they want?
- What do I need to do?
- What is risky?
- What can FlowDesk handle?
- What should never be sent without approval?

### Trust Model

Users do not trust an AI that replies to everything. They trust an assistant with visible rules, confidence, approval gates, audit history, and undo.

## Recommended Phases

### Phase 0: Foundations Already Underway

Goal: make the existing product feel like an assistant instead of an inbox.

Status: `Partial`

Included:

- Daily command center.
- Needs reply / waiting / done classification.
- Basic "Handle this" button.
- Relationship context-lite.
- Follow-up job infrastructure.
- Knowledge-document-backed drafts.
- Autopilot settings and approval infrastructure.
- Sensitive/risky thread detection-lite.

Next work:

- Persist command-center states instead of recomputing everything only at render time.
- Add first-class task and lead models.
- Add a real approval queue page.

### Phase 1: "Never Drop The Ball" MVP

Goal: deliver the clearest daily value for individuals and solo business users.

This phase should feel complete before expanding into team inboxes or deep integrations.

Features:

- Daily Command Center.
- Email-to-task extraction.
- Follow-up brain.
- Relationship memory.
- Sensitive email detection.
- Approval queue.
- Confidence score before sending.
- Smart labels that drive action.
- What Can I Ignore mode.
- Weekly value report.

Success criteria:

- User can open FlowDesk and know what to do first.
- User can see 0 dropped balls, or exactly which balls are at risk.
- User can approve, edit, or reject AI actions from one queue.
- User can understand why FlowDesk made each recommendation.

### Phase 2: Business Revenue Inbox Agent

Goal: make FlowDesk obviously worth paying for by connecting email to revenue.

Features:

- Business lead capture.
- Sales agent mode.
- Customer support agent mode.
- Lead scoring.
- Mini CRM pipeline.
- Knowledge base replies.
- Follow-up sequences.
- Meeting prep from email history.
- Post-meeting follow-up generator.
- Email triage by money impact.
- ROI analytics.

Success criteria:

- FlowDesk detects high-intent leads without setup-heavy CRM work.
- FlowDesk drafts useful replies from business knowledge.
- FlowDesk follows up on revenue opportunities.
- FlowDesk shows measurable value: leads found, replies drafted, follow-ups sent, hours saved.

### Phase 3: Personal Chief Of Staff

Goal: make FlowDesk useful beyond business email.

Features:

- Personal life admin mode.
- Bill/deadline tracking.
- Travel, school, medical appointment, insurance, subscription detection.
- VIP protection.
- Smart snooze / reply later intelligence.
- Attachment intelligence for forms, invoices, receipts, contracts.
- Natural-language search.
- Ask My Inbox chat.

Success criteria:

- User trusts FlowDesk to catch personal obligations.
- User can ask natural questions and get actionable answers.
- FlowDesk can distinguish safe informational email from life-admin email that matters.

### Phase 4: Automations And Integrations

Goal: let FlowDesk safely perform multi-step work across the user’s tools.

Features:

- Outcome-based automation.
- Train My Agent with plain English.
- Multi-step email workflows.
- Context from connected apps.
- Smart scheduling agent.
- Auto-generated snippets and playbooks.
- Auto-personalized outreach.
- One-click Clean My Inbox onboarding.

Success criteria:

- Users describe outcomes, not brittle rules.
- FlowDesk proposes automations based on repeated behavior.
- Automations remain auditable, reversible, and approval-gated by risk.

### Phase 5: Team Inbox Platform

Goal: support multi-person business operations.

Features:

- Business inbox shared assistant.
- Team inboxes.
- Assignments.
- Internal comments.
- Collision detection.
- Shared snippets.
- Team knowledge base.
- Team approval flows.
- Roles and permissions.
- SLA tracking.
- Team analytics.

Success criteria:

- Teams can collaborate without duplicate replies.
- Managers can audit agent and human actions.
- Shared knowledge improves replies across support, sales, billing, and founder inboxes.

## Feature Index

| # | Feature | Status | Recommended Phase | Notes |
|---|---|---|---|---|
| 1 | Magic Daily Command Center | `Partial` | Phase 0/1 | First slice shipped; needs persistence and richer source signals. |
| 2 | Autopilot Modes, Not Just Auto-Reply | `Partial` | Phase 4 | Basic settings exist; needs category rules and UI policy builder. |
| 3 | Handle This Button | `Partial` | Phase 0/1 | Button exists and triggers draft suggestion; needs task/lead/calendar side effects. |
| 4 | AI Follow-Up Brain | `Partial` | Phase 1 | Inbox follow-up tracker panel shipped; needs lead follow-up sequences. |
| 5 | Inbox Memory / Relationship Memory | `Partial` | Phase 1 | Persisted `PersonMemory` and conversation relationship panel shipped; extraction is deterministic and not user-editable yet. |
| 6 | Never Drop the Ball System | `Partial` | Phase 1 | Computed and persisted states exist; needs inbox views, alerts, and task actions. |
| 7 | Business Lead Capture From Email | `Partial` | Phase 2 | Lead model, extractor, stage controls, pipeline page, and background sync exist; needs scoring refinement and full CRM features. |
| 8 | Knowledge Base Replies | `Partial` | Phase 1/2 | Knowledge documents exist; needs source management and stronger citations. |
| 9 | Personal Voice Clone, Controlled | `Partial` | Phase 1 | Learned profile exists; needs clearer controls and style feedback. |
| 10 | Sensitive Email Detection | `Partial` | Phase 1 | Basic detection exists; needs richer categories and highlighted risky draft parts. |
| 11 | Meeting Prep From Email History | `Planned` | Phase 2 | Depends on calendar events, relationship memory, and thread summaries. |
| 12 | Post-Meeting Follow-Up Generator | `Planned` | Phase 2 | Depends on calendar events, notes/transcripts, tasks. |
| 13 | Email-to-Task Extraction | `Partial` | Phase 1 | Task model, extraction, list page, close action, background sync, and inline due-date editing exist; needs assignment and manual creation. |
| 14 | Smart Scheduling Agent | `Partial` | Phase 4 | Availability/holds exist; needs full back-and-forth booking. |
| 15 | Explain This Thread Like I’m Busy | `Planned` | Phase 1 | Could be first LLM summary view per thread. |
| 16 | Smart Attachment Intelligence | `Planned` | Phase 3 | Needs attachment ingestion, extraction, storage, safety. |
| 17 | Find Anything Natural Language Search | `Planned` | Phase 3 | Needs indexing, embeddings or search schema, permissions. |
| 18 | Business Inbox Shared Assistant | `Later` | Phase 5 | Needs team model and collaboration primitives. |
| 19 | Customer Support Agent Mode | `Planned` | Phase 2 | Should build on task, KB, sentiment, and support labels. |
| 20 | Sales Agent Mode | `Planned` | Phase 2 | Build after lead model and follow-up sequences. |
| 21 | Personal Life Admin Mode | `Planned` | Phase 3 | Needs personal category detection and safer privacy UX. |
| 22 | Email Risk Radar | `Planned` | Phase 1 | Good paid value; build on state engine and sensitive detection. |
| 23 | Phishing, Scam, and Fraud Protection | `Discovery` | Phase 3 | Needs careful security heuristics and false-positive UX. |
| 24 | Auto-Unsubscribe and Noise Killer | `Planned` | Phase 3/4 | Needs safe archive/unsubscribe permissions. |
| 25 | What Can I Ignore Mode | `Partial` | Phase 1 | Collapsible safely-ignored inbox section shipped; needs per-item reasons and bulk archive action. |
| 26 | Outcome-Based Automation | `Discovery` | Phase 4 | Depends on trust, audit, and rule engine. |
| 27 | Train My Agent With Plain English | `Discovery` | Phase 4 | Needs rule compiler and conflict resolution. |
| 28 | Approval Queue | `Partial` | Phase 1 | Inline approve/reject, collapsible draft preview, and batch approve/reject shipped; needs edit-before-send and teach-the-agent actions. |
| 29 | Confidence Score Before Sending | `Partial` | Phase 1 | Metadata exists; needs visible UX and policy thresholds. |
| 30 | Auto-Draft Based on User Intent | `Planned` | Phase 1 | Needs fast instruction-to-reply compose flow. |
| 31 | Multi-Step Email Workflows | `Discovery` | Phase 4 | Depends on tasks, leads, scheduling, audit, approvals. |
| 32 | Email Analytics That Show ROI | `Planned` | Phase 2 | Needs event tracking and weekly report. |
| 33 | VIP Protection | `Planned` | Phase 3 | Needs VIP/contact model and notification policy. |
| 34 | Reply Later, But Don’t Forget Intelligence | `Planned` | Phase 3 | Needs smart reminder model. |
| 35 | Context From Connected Apps | `Discovery` | Phase 4 | Integrations should follow use cases, not integration count. |
| 36 | AI Email Concierge For Local Businesses | `Planned` | Phase 2 | Strong positioning niche; build via vertical templates. |
| 37 | Auto-Generated Snippets and Playbooks | `Planned` | Phase 4 | Needs repeated-pattern mining and user approval. |
| 38 | Second Brain Inbox | `Planned` | Phase 3 | Depends on memory extraction and natural-language retrieval. |
| 39 | Auto-Personalized Outreach | `Later` | Phase 4 | Valuable, but avoid spam positioning. |
| 40 | Email Triage By Money Impact | `Partial` | Phase 2 | Lead/payment signals exist; needs command-center money-impact ranking and ROI views. |
| 41 | One-Click Clean My Inbox Experience | `Planned` | Phase 4 | Great onboarding; needs safe bulk operations. |
| 42 | Smart Email Labels That Matter | `Partial` | Phase 1 | Current labels are limited; needs action-oriented taxonomy. |
| 43 | Ask My Inbox Chat | `Planned` | Phase 3 | Should answer with actions, not just summaries. |
| 44 | Trust, Privacy, and Audit Log | `Partial` | Phase 1/All | Audit log exists; needs visible explanations and undo. |
| 45 | Magic Paid Version Packaging | `Discovery` | All | Use as product packaging, not engineering feature. |

## Immediate Next Slice Recommendation

The follow-up tracker, persisted `PersonMemory`, and conversation relationship panel shipped in the Phase 1 completion slice. Remaining Phase 1 work, in priority order:

### Next Slice: Finish Phase 1 — Sequences, Value Report, Thread Explanation

Why:

- Lead follow-up sequences are the last open item of the follow-up brain slice.
- The weekly value report is the only Phase 1 feature with zero implementation; it makes value visible and supports paid packaging later.
- Explain This Thread is the first LLM summary surface and reuses existing draft-generation infrastructure.

Suggested scope:

- Staged lead follow-up sequences (first follow-up, second follow-up, close) built on the existing follow-up job infrastructure.
- Weekly value report page aggregating drafts, tasks, leads, follow-ups, and approvals from existing records — no new tracking pipeline.
- Thread explanation panel: what happened, what they want, what you need to do, risks/deadlines.

See `docs/TODO.md` for the full remaining-work breakdown across all phases.

Do not build full CRM analytics or broad integrations in this slice.

## Data Model Roadmap

Likely future models:

- `ConversationState`: persisted state, reason, priority, confidence, source, updatedAt.
- `InboxTask`: title, dueAt, status, sourceConversationId, assignee, extractedFromMessageId.
- `Lead`: contact/company, need, urgency, budget clues, score, stage, nextAction.
- `PersonMemory`: contact-level summary, preferences, promises, relationship status.
- `AgentRule`: plain-English rule, compiled policy, category, enabled, confidence threshold.
- `AutomationRun`: multi-step workflow trace with inputs, outputs, approvals, tool calls.
- `AttachmentInsight`: extracted facts, deadlines, warnings, linked attachment.
- `ValueMetric`: weekly counters for time saved, drafts, follow-ups, leads, deadlines.

## Trust And Safety Rules

These rules apply to every phase:

- Legal, finance, health, HR, immigration, emotional conflict, refunds, contracts, and angry-customer emails require human review by default.
- Autopilot must be category-scoped, confidence-gated, and auditable.
- Every agent action should answer: what changed, why, confidence, rule used, source data, and how to undo.
- Never let a paid automation feature bypass safety policy.
- Prefer "draft and explain" before "send automatically."

## Packaging Plan

### Free

Purpose: let users feel the magic while leaving clear reasons to upgrade.

- Daily inbox summary.
- Basic AI drafts.
- Basic categorization.
- One connected inbox.
- Limited Ask My Inbox.
- Limited manual Handle This.
- No auto-send.
- No workflows.
- No business CRM.
- No advanced knowledge-base automation.

### Pro: Personal Chief Of Staff

Purpose: individual daily control.

- Unlimited AI drafts.
- Daily command center.
- Follow-up tracker.
- Smart reminders.
- Attachment summaries.
- Relationship memory.
- Natural-language inbox search.
- Calendar scheduling help.
- Personal admin detection.
- Auto-unsubscribe.
- Bill/deadline tracking.
- Safe auto-archive.
- Never Drop the Ball system.

### Business: Revenue Inbox Agent

Purpose: revenue and customer operations.

- Everything in Pro.
- Lead detection and lead scoring.
- CRM pipeline.
- Business knowledge base.
- Customer support mode.
- Sales follow-up sequences.
- Team inboxes.
- Approval workflows.
- Shared snippets/playbooks.
- Meeting prep and recap.
- Stripe/invoice/payment tracking.
- Analytics and ROI dashboard.

### Team

Purpose: multi-person inbox operations.

- Shared inboxes.
- Assignments.
- Internal comments.
- Collision detection.
- Team knowledge base.
- Admin controls.
- Permissions.
- Audit logs.
- SLA tracking.
- Team analytics.

## Agent Handoff Protocol

Before an AI agent starts work:

1. Read this file.
2. Read any linked spec or plan for the target feature.
3. Check `git status --short`.
4. Identify whether the target is Phase 1 foundation work, Phase 2 revenue work, or later.
5. If the feature depends on missing foundations, create the foundation spec first.
6. Use test-first implementation for behavior changes.
7. Update this master plan when status changes.

After an AI agent finishes work:

1. Add or update links to the relevant spec and implementation plan.
2. Move feature status forward only if verified.
3. Add a decision log entry for major scope changes.
4. Document verification commands.
5. Note any blocked visual QA or missing local infrastructure.

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-11 | Treat the 45-feature brief as a roadmap, not one implementation batch. | The feature set spans multiple subsystems: tasks, CRM, memory, search, automations, teams, trust, and pricing. |
| 2026-06-11 | Ship Daily Command Center as the first slice. | It creates the first wow moment and reuses existing conversations, drafts, approvals, jobs, calendar holds, and labels. |
| 2026-06-11 | Recommend Tasks + Leads + Approval Queue as the next foundation. | These models unlock the largest number of downstream features without overbuilding workflows. |
| 2026-06-11 | Move next recommendation to review actions and background sync. | The foundation models and first UI surfaces now exist; users need correction/action paths and reliable syncing. |
| 2026-06-11 | Ship review actions and background sync slice. | Task close, lead stage controls, approval queue decisions, /tasks and /leads pages, and background sync after Gmail/Outlook import are now implemented. Next priority is follow-up brain and relationship memory. |
| 2026-06-11 | Ship Phase 1 completion slice (commit `0e5926a`). | Persisted `PersonMemory` with relationship panel, task due-date editing, approval draft preview and bulk decisions, inbox follow-up tracker, and safely-ignored section. Remaining Phase 1 gaps: lead follow-up sequences, weekly value report, thread explanation, risk radar. |
| 2026-06-11 | Add `docs/TODO.md` as the canonical remaining-work checklist. | The feature index tracks status, but agents and humans need a single prioritized to-do view of what is not yet built, mapped to the 45-feature brief. |

## Open Product Questions

- Which first paid persona matters most: personal chief of staff, local business revenue inbox, or team support desk?
- Should `Lead` be generic enough for all businesses or opinionated toward a first niche like tutors, clinics, agencies, dentists, or salons?
- What actions should be allowed in free accounts versus paid accounts?
- How much user-visible explanation is enough before automation feels noisy?
- Which integrations are required for the first paid wedge: calendar, Stripe, Calendly, Drive, Notion, or CRM?
- Should relationship memory be fully automatic, user-editable, or both?
- How should users correct the agent when classification or memory is wrong?
