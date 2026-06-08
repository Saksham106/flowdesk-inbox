# FlowDesk Inbox — Email-First AI Front Desk Plan

This document replaces the old SMS/Twilio-first sprint plan. The new strategy is to build an email-first AI front desk for small businesses, starting with appointment-heavy businesses such as med spas. Twilio/SMS can return later, after the product proves value and the A2P 10DLC/compliance burden is worth taking on.

## Business Goal

FlowDesk gives small business owners access to practical AI without requiring them to understand prompts, agents, APIs, or automation tooling.

The product should not be sold as "AI access." It should be sold as:

> An AI front desk that reads inbound email, drafts safe replies, follows up with leads, and helps book appointments on the business calendar.

The first wedge is appointment-heavy local businesses that lose revenue when inbound inquiries sit unanswered.

## Core Product Thesis

Small businesses do not need a general-purpose autonomous agent. They need a reliable, permissioned operator for a few high-value workflows:

- Respond to inbound email quickly.
- Identify leads, booking requests, reschedules, pricing questions, complaints, and spam.
- Draft replies in the business's tone.
- Check calendar availability.
- Suggest or schedule appointments.
- Escalate sensitive/risky conversations to humans.
- Keep a clear audit trail of what the AI saw, decided, drafted, and did.

The system should behave like an AI employee, but be implemented as event-driven workflows with explicit tools, permissions, memory, and approval gates.

## Research Notes: Hermes Agent and OpenClaw

### Hermes Agent

Hermes is useful as a design reference because it has:

- A central `AIAgent` core behind multiple entry points: CLI, gateway, ACP, API server, batch runner, and Python library.
- Prompt assembly, provider resolution, tool dispatch, compression/caching, session storage, and memory as separate concepts.
- Toolsets that can be enabled/disabled by platform.
- Bounded persistent memory plus searchable session history.
- Scheduled jobs that run in fresh sessions with self-contained prompts.
- A defense-in-depth security model: user authorization, command approvals, container isolation, credential filtering, context scanning, cross-session isolation, and input sanitization.

Source docs:
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/developer-guide/architecture
- https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
- https://hermes-agent.nousresearch.com/docs/user-guide/security/

### OpenClaw

OpenClaw is useful as a design reference because it has:

- A Gateway control plane for channels, sessions, tools, and events.
- Multi-agent routing with separate workspaces, agent dirs, credentials, and session stores.
- A delegate-agent model for organizational assistants that act on behalf of a business without impersonating a human.
- Capability tiers: read-only/draft, send-on-behalf, proactive operations.
- Per-agent tool restrictions and sandbox settings.
- Skills as markdown instruction packs, tools as typed actions, and plugins as packaged capabilities.

Source docs:
- https://github.com/openclaw/openclaw
- https://docs.openclaw.ai/
- https://docs.openclaw.ai/concepts/delegate-architecture
- https://docs.openclaw.ai/tools
- https://docs.openclaw.ai/tools/index
- https://docs.openclaw.ai/gateway/protocol
- https://docs.openclaw.ai/multi-agent

### Decision: Do Not Embed Hermes/OpenClaw as the Production Brain Yet

FlowDesk should not directly run one Hermes/OpenClaw instance per customer as the first production architecture.

Reasons:

- This is a multi-tenant SaaS, not a single-user personal assistant.
- Customer email/calendar credentials require strict isolation.
- Business owners need predictable workflows, not broad open-ended autonomy.
- Every action needs audit logs and reversible human approval paths.
- A general agent runtime has too much tool surface area for an early regulated/reputation-sensitive product.

Instead, FlowDesk should borrow the architecture patterns:

- Event-driven agent jobs.
- Scoped tools.
- Bounded tenant memory.
- Skills/standing orders.
- Fresh-session scheduled jobs.
- Approval gates.
- Per-tenant isolation.
- Full audit trail.

## New Architecture Direction

FlowDesk should become an event-driven AI workflow system.

High-level flow:

```text
Inbound Gmail message
  -> store message in database
  -> create AgentJob
  -> classify intent
  -> retrieve business knowledge and conversation history
  -> optionally inspect calendar availability
  -> draft reply
  -> require approval or mark eligible for autopilot
  -> send via Gmail only after policy allows it
  -> write audit log for every decision/tool/action
```

The AI should run on demand when something happens, not sit around as an always-running thinking process.

Always-running infrastructure:

- Next.js app
- Database
- Gmail sync/webhook/polling
- Background worker or scheduled job runner
- Agent job queue
- Audit log

On-demand AI:

- Classification
- Drafting
- Calendar reasoning
- Follow-up decisioning
- Escalation decisioning

## Product Scope Reset

### Keep

- Multi-tenant auth.
- Gmail connector.
- Google Calendar connector.
- Conversation inbox.
- Contacts.
- Labels/status.
- Draft model concept.
- Audit logs.
- MindBody as optional future vertical integration for med spas.

### Pause

- Twilio inbound SMS.
- Twilio outbound SMS.
- Twilio voice/missed-call flow.
- A2P 10DLC work.
- SMS-first onboarding.

### Add

- Email-first AI draft pipeline.
- Business profile and knowledge base.
- Agent job lifecycle.
- Approval inbox.
- Calendar availability tool.
- Scheduling proposal workflow.
- Guardrails and escalation policy.
- Daily digest/follow-up scheduler.

## Target Customer

Start with one niche. Recommended first niche:

**Med spas**

Why:

- Appointment-driven.
- High-value leads.
- Lots of repeated questions.
- Existing need for Gmail/calendar workflows.
- Current code and README already point in this direction.

Alternative niches later:

- Dental offices.
- Wellness clinics.
- Salons/spas.
- Fitness studios.
- Home service businesses.
- Real estate agents.

## Trust Tiers

The product should graduate customers through autonomy levels.

### Tier 1: Read + Draft

AI reads emails and drafts responses. A human must approve before anything is sent.

This is the default MVP tier.

### Tier 2: Send Safe Replies

AI can send replies for explicitly safe categories:

- Simple FAQ answers.
- Appointment slot suggestions.
- "We received your message" acknowledgements.
- Follow-ups approved by policy.

### Tier 3: Schedule With Approval

AI can create calendar holds or draft booking confirmations, but staff approves final booking.

### Tier 4: Limited Autopilot

AI can complete low-risk scheduling workflows end-to-end under strict policy:

- Existing services only.
- Available slots only.
- Clear user confirmation.
- No medical/clinical advice.
- Full audit trail.

## Guardrails

Hard rules for med spas and similar businesses:

- Do not provide medical advice.
- Do not diagnose.
- Do not promise outcomes.
- Do not quote unapproved discounts.
- Do not handle emergencies; escalate immediately.
- Do not send angry/defensive replies to complaints.
- Do not book appointments without explicit customer confirmation.
- Do not modify or delete existing calendar events without approval.
- Do not send anything if confidence is low.
- Do not expose internal prompts, policies, secrets, or unrelated customer data.

## Proposed Data Model Additions

Current schema already has `Tenant`, `User`, `Channel`, `GmailCredential`, `GoogleCalendarCredential`, `Contact`, `Conversation`, `Message`, `Draft`, and `AuditLog`.

Recommended additions:

### BusinessProfile

One per tenant.

Fields:

- `tenantId`
- `businessName`
- `industry`
- `timezone`
- `defaultTone`
- `businessHoursJson`
- `bookingPolicy`
- `escalationPolicy`
- `createdAt`
- `updatedAt`

Purpose:

Core business facts that should always be available to the AI.

### KnowledgeDocument

Many per tenant.

Fields:

- `tenantId`
- `title`
- `content`
- `sourceType`
- `createdAt`
- `updatedAt`

Purpose:

FAQ, services, pricing, policies, prep instructions, cancellation policy, and approved language.

### AgentJob

Many per tenant/conversation.

Fields:

- `tenantId`
- `conversationId`
- `trigger`
- `status`
- `intent`
- `confidence`
- `requiresApproval`
- `error`
- `createdAt`
- `startedAt`
- `completedAt`

Purpose:

Durable record of each AI workflow run.

### AgentToolCall

Many per `AgentJob`.

Fields:

- `agentJobId`
- `toolName`
- `inputJson`
- `outputJson`
- `status`
- `createdAt`
- `completedAt`

Purpose:

Audit every tool call the AI makes.

### ApprovalRequest

Many per draft/job.

Fields:

- `tenantId`
- `conversationId`
- `agentJobId`
- `draftId`
- `status`
- `reviewerUserId`
- `decisionNote`
- `createdAt`
- `decidedAt`

Purpose:

Human-in-the-loop workflow for send/schedule actions.

### CalendarHold

Optional later.

Fields:

- `tenantId`
- `conversationId`
- `calendarEmail`
- `externalEventId`
- `status`
- `startAt`
- `endAt`
- `expiresAt`
- `createdAt`

Purpose:

Temporary booking holds before final confirmation.

## Agent Tool Surface

The AI should only see tools that are safe for the current job and trust tier.

Initial tools:

- `getConversationThread(conversationId)`
- `getBusinessProfile(tenantId)`
- `searchKnowledgeBase(tenantId, query)`
- `classifyConversation(thread, businessProfile)`
- `draftEmailReply(thread, businessContext, policy)`
- `checkCalendarAvailability(tenantId, calendarEmail, dateRange)`
- `createApprovalRequest(draftId, reason)`
- `markNeedsHuman(conversationId, reason)`

Later tools:

- `sendApprovedEmail(draftId)`
- `createCalendarHold(...)`
- `confirmCalendarEvent(...)`
- `syncMindBodyClient(...)`
- `bookMindBodyAppointment(...)`
- `sendSms(...)`

The AI should not receive raw Gmail tokens, database credentials, or broad filesystem/browser/shell access.

## Sprint Roadmap

## Sprint 0 — Product Reset and Cleanup

Goal: Make the repo honest about the email-first direction and pause Twilio complexity.

Tasks:

- [ ] Update README to describe email-first AI front desk positioning.
- [ ] Mark Twilio/SMS routes as paused or move them behind documentation notes.
- [ ] Decide whether to keep Twilio code in-place but unused, or remove it from the current MVP path.
- [ ] Update `.env.example` so Gmail/Calendar/OpenAI are primary and Twilio is optional/future.
- [ ] Add a clear "Current MVP Scope" section to README.
- [ ] Add a "Deferred SMS/Twilio" section explaining A2P 10DLC rationale.

Acceptance criteria:

- A new developer can tell that Gmail/calendar/AI draft is the active product path.
- Twilio is not required to run or demo the MVP.

## Sprint 1 — Email Inbox Foundation

Goal: Make Gmail the primary communication channel.

Tasks:

- [ ] Keep Gmail OAuth connect/disconnect/sync.
- [ ] Improve Gmail sync reliability and error reporting.
- [ ] Add manual "Sync Gmail" status and last sync timestamp.
- [ ] Make email contact fields semantically clear in UI, even if database fields still use `phoneE164`.
- [ ] Add tests for Gmail sync contact/conversation/message upserts.
- [ ] Add tests for tenant isolation in Gmail sync and send routes.

Acceptance criteria:

- A business can connect Gmail, import recent threads, view them in the inbox, and reply manually.
- Email does not feel bolted onto an SMS product in the UI.

## Sprint 2 — Business Profile and Knowledge Base

Goal: Give the AI approved business context.

Tasks:

- [ ] Add `BusinessProfile` model.
- [ ] Add `KnowledgeDocument` model.
- [ ] Add settings UI for business name, industry, timezone, tone, hours, booking policy, and escalation policy.
- [ ] Add UI for creating/editing FAQ and service/policy documents.
- [ ] Add server helpers for retrieving compact business context.
- [ ] Add tests for tenant-scoped profile and knowledge access.

Acceptance criteria:

- Each tenant can define the facts and rules the AI needs.
- AI context is tenant-scoped and does not mix businesses.

## Sprint 3 — Agent Job Pipeline

Goal: Introduce a durable AI workflow layer without making it fully autonomous.

Tasks:

- [ ] Add `AgentJob` model.
- [ ] Add `AgentToolCall` model.
- [ ] Create an agent service module, likely `lib/agent/`.
- [ ] Implement `createAgentJobForConversation`.
- [ ] Implement deterministic pre-checks before any AI call.
- [ ] Implement structured classification output.
- [ ] Store classification intent/confidence on `AgentJob`.
- [ ] Log all tool-like helper calls to `AgentToolCall`.
- [ ] Add tests for job creation, status transitions, failure states, and audit logging.

Acceptance criteria:

- New inbound/synced email conversations can create an agent job.
- The job can classify the conversation and persist the result.
- Failures are visible and do not break inbox usage.

## Sprint 4 — AI Draft Replies With Human Approval

Goal: Generate useful draft replies, but require staff approval before sending.

Tasks:

- [ ] Add an AI provider abstraction.
- [ ] Choose initial provider/model.
- [ ] Define strict structured output schema for draft replies.
- [ ] Generate drafts from conversation history, business profile, and knowledge documents.
- [ ] Store generated text in `Draft`.
- [ ] Add `ApprovalRequest` model.
- [ ] Add UI panel for reviewing AI draft.
- [ ] Add approve/edit/reject actions.
- [ ] Only send email through existing Gmail send route after approval.
- [ ] Write audit logs for generated, edited, approved, rejected, and sent states.

Acceptance criteria:

- Staff can click "Suggest reply" or have a draft generated after sync.
- Staff can edit and approve.
- Nothing sends automatically.

## Sprint 5 — Calendar-Aware Scheduling Suggestions

Goal: Let AI propose appointment times from Google Calendar availability.

Tasks:

- [ ] Expose a safe server-side `checkAvailability` tool.
- [ ] Add settings to choose the primary booking calendar.
- [ ] Add service duration defaults in business profile or knowledge base.
- [ ] Detect scheduling intent in agent classification.
- [ ] When scheduling intent is present, call availability helper.
- [ ] Draft replies with 2-3 available slots.
- [ ] Add tests for availability window handling and timezone conversion.

Acceptance criteria:

- AI can draft replies like "We have Tuesday at 2:00 PM or Thursday at 11:30 AM."
- AI does not create or change events yet.

## Sprint 6 — Calendar Holds and Confirmed Booking

Goal: Move from suggestion to controlled scheduling.

Tasks:

- [ ] Add `CalendarHold` model.
- [ ] Let staff create a calendar hold from the approval UI.
- [ ] Expire stale holds.
- [ ] When the customer confirms a slot, prepare a final booking action.
- [ ] Require staff approval before creating final calendar event.
- [ ] Write audit logs for holds, expirations, and confirmed events.

Acceptance criteria:

- Staff can convert an AI-suggested slot into a real event.
- The product avoids double-booking and stale holds.

## Sprint 7 — Follow-Up Automation and Daily Digest

Goal: Add scheduled workflows inspired by Hermes/OpenClaw cron, but implemented inside FlowDesk.

Tasks:

- [ ] Add scheduled job runner or cron-compatible endpoint.
- [ ] Find stale conversations that need follow-up.
- [ ] Generate follow-up drafts, not automatic sends.
- [ ] Create daily digest email/page for staff.
- [ ] Add per-tenant follow-up settings.
- [ ] Add tests for scheduled job idempotency.

Acceptance criteria:

- Staff gets a useful daily summary.
- Leads that go quiet are surfaced with draft follow-ups.

## Sprint 8 — Limited Autopilot

Goal: Allow safe categories to send automatically only after trust is earned.

Tasks:

- [ ] Add tenant-level autopilot settings.
- [ ] Add category-level autonomy settings.
- [ ] Add policy checks before automatic send.
- [ ] Add confidence threshold.
- [ ] Add "autopilot disabled after repeated failures" safeguard.
- [ ] Add admin audit view for all autopilot actions.

Acceptance criteria:

- Autopilot can be enabled for narrow low-risk workflows.
- Every automatic action is explainable, auditable, and reversible where possible.

## Sprint 9 — Vertical Integrations

Goal: Add high-value integrations once core email/calendar AI works.

Tasks:

- [ ] Revisit MindBody for med spa appointment/client lookup.
- [ ] Add service catalog sync if MindBody proves valuable.
- [ ] Add booking into MindBody only after calendar scheduling works.
- [ ] Revisit SMS/Twilio once there is paying customer demand.
- [ ] Revisit voice/missed-call automation after SMS compliance is worth the cost.

Acceptance criteria:

- New integrations are customer-pull, not infrastructure-driven.

## Implementation Principles

Follow these principles while building:

- Prefer event-driven jobs over always-running autonomous agents.
- Keep all AI actions tenant-scoped.
- Give the AI narrow tools, not raw credentials.
- Require approval for send/schedule actions at first.
- Log every AI decision and tool call.
- Store durable job state for retries and debugging.
- Treat inbound email as untrusted input.
- Keep prompts self-contained for scheduled jobs.
- Make every autonomy increase a tenant-level opt-in.

## Technical TODO List

### Immediate

- [ ] Update README for the email-first pivot.
- [ ] Decide whether Twilio code is hidden, removed, or left as future infrastructure.
- [ ] Add OpenAI or chosen AI provider dependency.
- [ ] Add AI provider abstraction.
- [ ] Add tests framework if none exists.
- [ ] Add `BusinessProfile` schema.
- [ ] Add `KnowledgeDocument` schema.
- [ ] Add profile/settings UI.
- [ ] Add knowledge base UI.
- [ ] Add `AgentJob` schema.
- [ ] Add `AgentToolCall` schema.
- [ ] Add `ApprovalRequest` schema.

### AI Workflow

- [ ] Define classification schema.
- [ ] Define draft reply schema.
- [ ] Define escalation schema.
- [ ] Define tool-call log schema.
- [ ] Build `lib/agent/context.ts`.
- [ ] Build `lib/agent/classify.ts`.
- [ ] Build `lib/agent/draft.ts`.
- [ ] Build `lib/agent/jobs.ts`.
- [ ] Build `lib/agent/policy.ts`.
- [ ] Add prompt-injection defensive instructions.
- [ ] Add confidence thresholds.
- [ ] Add escalation reasons.

### UI

- [ ] Add AI draft panel on conversation page.
- [ ] Add "Suggest reply" button.
- [ ] Add approve/edit/reject flow.
- [ ] Add approval status badges.
- [ ] Add agent job status display.
- [ ] Add settings pages for AI policies.
- [ ] Add daily digest page.

### Calendar

- [ ] Add primary calendar selection.
- [ ] Add availability helper.
- [ ] Add timezone-safe slot formatting.
- [ ] Add draft scheduling suggestions.
- [ ] Add calendar hold model.
- [ ] Add calendar hold UI.
- [ ] Add final booking approval.

### Safety and Ops

- [ ] Add audit view.
- [ ] Add job retry policy.
- [ ] Add idempotency keys for agent jobs.
- [ ] Add rate limiting for AI calls.
- [ ] Add per-tenant AI usage tracking.
- [ ] Add failure alerts.
- [ ] Add prompt/version tracking.
- [ ] Add seed data for demo business profile and FAQ.

### Later

- [ ] Reintroduce SMS only after email AI closes pilots.
- [ ] Investigate Twilio compliance path when customers request SMS.
- [ ] Add MindBody booking after calendar booking works.
- [ ] Add autopilot after enough approved draft data exists.
- [ ] Explore Hermes/OpenClaw interoperability only for internal research/dev tooling, not core customer runtime.

## Open Questions

- Which AI provider/model should be used first?
- Should the first niche remain med spas, or should the product be positioned as appointment-heavy local businesses?
- Should Twilio code be deleted now or left dormant?
- Should the first MVP generate drafts automatically on sync, or only when staff clicks "Suggest reply"?
- Should calendar booking create temporary holds, or only suggest slots until later?

## Recommended Next Move

Build Sprint 0 and Sprint 1 first, then implement the AI draft pipeline in Sprints 2-4.

The first demo should be:

```text
Connect Gmail
Connect Calendar
Add business profile + FAQ
Import email thread
Click "Suggest reply"
AI drafts a safe reply using business knowledge
Staff approves
Reply sends through Gmail
Audit log records the full flow
```

That demo is enough to sell pilots.
