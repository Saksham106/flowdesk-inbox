# Product Plan

Last updated: 2026-07-07

## Product thesis

FlowDesk is the Gmail-native AI email operator with a polished companion web app. It works inside the user's existing Gmail to label, prioritize, draft, follow up, and organize email automatically. **Gmail is the primary surface** — most users interact with FlowDesk almost entirely through Gmail's labels, drafts, and follow-up nudges, so the Gmail-native side must work *really well*. **The web app is a secondary but genuinely polished surface** — setup, rules, training, approvals, audit logs, daily brief, and deeper review — held to the same quality bar even though users won't live there. We take direct design and implementation inspiration (and code) from Inbox Zero, Tom Shaw's AI agent inbox, and the other reference projects.

> **Current focus (2026-07-07): the trustworthy core loop.** Correctness before features. The loop *classify → act in Gmail → reflect state truthfully in the UI* must be reliable — see `docs/product-direction.md` → Roadmap (Phase 1) and `docs/CURRENT_STATE.md` → "Known-broken".

The product should consistently do five things:

1. Project useful organization into Gmail with readable labels and safe state changes.
2. Know what matters, what can be ignored, and who needs follow-up.
3. Draft useful replies in the user's voice, with approval gates before risky actions.
4. Remember relationship context and operational rules.
5. Make every automated action inspectable, correctable, and reversible where possible.

## Product principles

1. Prioritize obligations, relationships, risk, and revenue over inbox volume.
2. Preserve explicit user intent across provider synchronization and classification.
3. Use Gmail API actions as the source of truth for mailbox mutations; use the dashboard for supervision and configuration.
4. Prefer deterministic handling for routine mail; use richer AI where it adds measurable value.
5. Draft and explain before automating; gate sensitive actions by confidence and risk.
6. Keep connector work incremental, idempotent, bounded, observable, and recoverable.

## North star experience

### Gmail-native organization

When a user opens Gmail, the inbox should already be organized with stable FlowDesk labels such as Needs Reply, Waiting On, Follow Up, Read Later, Handled, Autodrafted, and Low Priority. Handle First remains a FlowDesk dashboard ranking so Gmail labels do not churn as priorities are recalculated. The user should see value before visiting the FlowDesk website.

### Control room brief

The FlowDesk web app should say: "Here is what your agent did, what needs approval, and what matters today." It shows needs-reply, waiting-on-others, meetings that need prep, bills and deadlines, opportunities and leads, potential problems, and things safely ignored.

### Thread view

Every thread should answer: who sent this and when, what happened, what do they want, what do I need to do, what is risky, what can FlowDesk handle, and what should never be sent without approval.

### Trust model

Users do not trust an AI that replies to everything. They trust an assistant with visible rules, confidence scores, approval gates, audit history, and undo.

## Phases

### Phase 1 — Trustworthy core loop — active priority

The Gmail-native foundations (label projection, native drafts, waiting-on/follow-up) are **built**, but the end-to-end loop is not reliable: labels get created without being applied to threads, and explicit user state changes ("Mark done") don't stick on refresh. Phase 1 fixes correctness first — make label projection a reliable consequence of sync/classification, make persisted user state the single source of truth in the dashboard, and verify the loop end-to-end in the real app. Nothing new ships until this holds. See `docs/CURRENT_STATE.md` → "Known-broken" and `docs/TODO.md` → Phase 1.

### Phase 2 — Web-app polish — next

The companion web app must look and feel like a real product: split the oversized settings page, rebuild the dashboard/inbox shell Inbox-Zero-style, and clean up navigation. Secondary surface, but a high quality bar.

### Phase 3 — Capability parity — after polish

Port marquee capabilities from the reference repos (bulk unsubscribe depth, smart categories, reply-tracking UX, richer rule authoring), copying code where it helps. See `docs/flowdesk-vs-reference-gap-analysis.md`.

### Gmail-native drafts and follow-up tracking — built

Real Gmail drafts (deduped, `Autodrafted`-labeled, manual-reply-aware), outbound waiting-on detection, and `Waiting On` / `Follow Up` labels in Gmail all ship today. Remaining reliability work is folded into Phase 1.

### Control room dashboard — implemented, repositioning

Command center, attention categories, tasks, follow-ups, approval queue, relationship memory, sensitive detection, local drafts, risk radar, and value reporting are available. Repositioning and polish are folded into Phase 2; correctness of its state handling is folded into Phase 1.

### Revenue inbox — implemented first slices

Lead capture/scoring, sales and support signals, knowledge-backed drafts, follow-up sequences, meeting workflows, pipeline reporting, and revenue-at-risk views exist. Remaining work is product depth, settings, and validation with a clear business persona.

### Personal chief of staff — implemented first slices

Life-admin classification, bills/deadlines, VIPs, snooze, attachment extraction, search, inbox chat, second-brain facts, phishing warnings, and unsubscribe workflows exist. Remaining work is accuracy, retrieval quality, and broader obligation workflows.

### Automations and integrations — implemented foundations

Plain-English rules, autopilot policies, snippets, Clean Inbox, scheduling sessions, automation traces/rollback, workflow templates, Calendar, and Drive foundations exist. Complete the unfinished workflows before expanding connector breadth.

### Team inbox platform — later

Shared inboxes, assignments, comments, collision detection, roles, permissions, SLAs, and team analytics require a dedicated collaboration model and should not be layered onto the single-user foundation piecemeal.

## Feature index

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Daily Command Center / Control Room | `Partial` | First slice shipped; needs Gmail-native status indicators, persistence, and richer source signals. |
| 2 | Autopilot Modes | `Partial` | Settings policy table shipped; agent jobs now execute via `GET /api/cron/agent-jobs`. Autopilot sends remain fully gated (opt-in, learned profile, confidence/per-intent thresholds, daily cap, failure limit) and are off by default. |
| 3 | Handle This Button | `Partial` | Button exists and triggers draft suggestion; needs task/lead/calendar side effects. |
| 4 | AI Follow-Up Brain | `Partial` | Follow-up tracker and lead sequences shipped; enqueued jobs now execute via the agent-jobs cron. Sequence settings UI and sent-output visibility remain. |
| 5 | Relationship Memory | `Partial` | Persisted `PersonMemory`, relationship panel, user editing, gated LLM extraction; richer history and retrieval remain. |
| 6 | Never Drop the Ball | `Partial` | Attention taxonomy, inbox filters, and corrections exist; clearer alerts and filter coverage remain. |
| 7 | Business Lead Capture | `Partial` | LLM scoring, score explanation, estimated value, CRM funnel header shipped. CRM search and value forecasting remain. |
| 8 | Knowledge Base Replies | `Partial` | URL import, citations in drafts shipped. Re-crawl and semantic search remain. |
| 9 | Personal Voice Clone | `Partial` | Learned profile exists; clearer controls and style feedback remain. |
| 10 | Sensitive Email Detection | `Partial` | Security/billing/legal/medical/emotional detection and draft warnings shipped; broader coverage ongoing. |
| 11 | Meeting Prep | `Partial` | On-demand brief from PersonMemory + threads; `/meetings` page + digest card. Briefs not persisted. |
| 12 | Post-Meeting Follow-Up | `Partial` | Notes + prior threads → follow-up draft → ApprovalRequest shipped. |
| 13 | Email-to-Task Extraction | `Partial` | Task model, extraction, list page, due-date editing, manual creation; assignment remains later. |
| 14 | Smart Scheduling Agent | `Partial` | SchedulingSession model, detector, slot proposal via Calendar API, SchedulingPanel. Confirmation and booking not yet wired. |
| 15 | Explain This Thread | `Partial` | On-demand LLM explanation panel on conversation pages; persistence and inbox surfacing remain. |
| 16 | Attachment Intelligence | `Partial` | EmailAttachment model, MIME detection, PDF extraction; richer previews and actions remain. |
| 17 | Natural Language Search | `Partial` | Message tsvector search, /search page; semantic/embedding search remains. |
| 18 | Team Shared Inbox | `Later` | Needs team model and collaboration primitives. |
| 19 | Customer Support Mode | `Partial` | Auto-detect, churn-risk flags, KB-match drafts, SupportPanel; richer workflows remain. |
| 20 | Sales Agent Mode | `Partial` | Sales signals, SalesPanel, sales-qualified state; richer workflows and settings remain. |
| 21 | Personal Life Admin | `Partial` | Bills, travel, medical, subscriptions, school detected; broader workflows remain. |
| 22 | Email Risk Radar | `Shipped` | Deterministic scan for deadline-soon, final-notice, unanswered, sensitive-content on `/risk-radar`. |
| 23 | Phishing Protection | `Partial` | Signal-scored classifier, warning banner, mark-safe; ongoing tuning and false-positive UX remain. |
| 24 | Auto-Unsubscribe | `Partial` | Safe unsubscribe, Gmail archive/trash, Clean Inbox shipped; broader provider cleanup remains. |
| 25 | What Can I Ignore | `Partial` | Safely-ignored section, attention reasons, bulk close, archive/trash shipped; broader cleanup later. |
| 26 | Outcome-Based Automation | `Partial` | AutomationRun trace, step executor (create_task, update_attention, archive), rollback. Trigger conditions not user-configurable yet. |
| 27 | Train My Agent | `Shipped` | AgentRule model, budget-metered NL compiler, preview endpoint, conflict detection, settings UI. |
| 28 | Approval Queue | `Partial` | Inline approve/reject, batch actions, draft preview; edit-before-send and teach-the-agent remain. |
| 29 | Confidence Before Sending | `Partial` | Draft confidence, sensitive warnings, per-category autopilot thresholds; clearer user-facing policy education remains. |
| 30 | Auto-Draft on Intent | `Partial` | AI draft panel accepts rough instructions and produces approval-gated local drafts. Gmail-native draft creation remains. |
| 31 | Multi-Step Workflows | `Partial` | WorkflowTemplate + WorkflowRun, runner, cron, 3 seeded templates, settings panel. Builder UI not yet implemented. |
| 32 | Email Analytics / ROI | `Shipped` | 4-week trend bars, pipeline value, revenue opportunities on `/reports`; `ValueSnapshot` with weekly cron. |
| 33 | VIP Protection | `Shipped` | VipContact model, detector, urgent priority, inbox badge, conversation banner, settings form. |
| 34 | Reply Later / Snooze | `Partial` | SnoozeReminder model, API, cron, modal, Snoozed tab, valid priority restore, resurfaced banner; smarter suggestions remain. |
| 35 | Context From Connected Apps | `Partial` | Google Drive OAuth, searchDriveForContext; not yet injected into draft generation. |
| 36 | AI Concierge Templates | `Partial` | Local-business templates, seed route, reply-composer picker; deeper vertical workflows remain. |
| 37 | Snippets and Playbooks | `Shipped` | Snippet model, weekly miner, API, settings panel, picker in reply composer. |
| 38 | Second Brain / Inbox Memory | `Partial` | PersonMemory facts, fact extractor, SecondBrainPanel; natural-language retrieval remains. |
| 39 | Auto-Personalized Outreach | `Later` | Valuable, but avoid spam positioning. |
| 40 | Email Triage by Money Impact | `Shipped` | Revenue-weighted score bonus in command center; Revenue at Risk subsection for stale high-value leads. |
| 41 | Clean My Inbox | `Shipped` | /clean-inbox page, batch archive/unsubscribe, 1-hour undo via AuditLog. |
| 42 | Gmail-Native Smart Labels | `Partial` | Canonical `FlowDesk/*` label vocabulary, state mapping, queued Gmail label writeback, and audit events shipped. Label bootstrap, classification-triggered projection, settings, and explainability remain. |
| 43 | Ask My Inbox Chat | `Partial` | Budget-metered streaming RAG pipeline, /chat page, SSE route; action-taking answers remain later. |
| 44 | Trust, Privacy, and Audit Log | `Partial` | Audit log and undo for reversible autopilot approvals; broader coverage remains. |
| 45 | Paid Packaging | `Discovery` | Use as product packaging decision, not an engineering feature. |

## Current priorities

1. Finish Gmail-native labels: bootstrap on connect, apply after classification, expose label settings, and show Gmail-native status in the control room.
2. Build Gmail-native drafts: create provider drafts, dedupe by thread/latest message, mark `Autodrafted`, and detect manual replies.
3. Make classification and Gmail mutations inspectable — show why a thread was labeled, with source, rule/AI/user, confidence, key evidence, audit history, and correction path.
4. Add automation level controls before expanding auto-read/archive/send behavior.
5. Complete waiting-on/follow-up tracking across sent threads.
6. Finish provider reliability gaps where they support the core wedge, including Gmail CID images and Outlook writeback parity.

## Trust and safety invariants

- Legal, financial, health, HR, immigration, security, dispute, and emotionally sensitive messages require human review by default.
- Autopilot remains category-scoped, confidence-gated, auditable, and reversible where possible.
- Every agent action should expose what changed, why, its source, and how to correct it.
- No paid feature may bypass safety policy.
- Prefer "draft and explain" before "send automatically."

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-11 | Treat the 45-feature brief as a phased roadmap, not one implementation batch. | The feature set spans multiple subsystems: tasks, CRM, memory, search, automations, teams, trust, and pricing. |
| 2026-06-11 | Ship Daily Command Center as the first slice. | Creates the first wow moment and reuses existing conversations, drafts, approvals, jobs, calendar holds, and labels. |
| 2026-06-11 | `command-center.ts` is a pure analysis module — accepts plain objects, no Prisma calls. | Keeps the analyzer independently unit-testable; pages own data fetching and can evolve separately. |
| 2026-06-11 | Store lead sequence state in `Lead.metadataJson` instead of a new model. | Avoids a schema migration; state is two fields. Promote to a dedicated model if sequences grow. |
| 2026-06-11 | Compute the weekly value report live from existing records; no `ValueMetric` model yet. | All eight metrics are cheap tenant-scoped counts; persisted snapshots only become necessary for trends. |
| 2026-06-12 | Add a deterministic `email-classifier.ts` before LLM classification. | Notifications, newsletters, and no-reply senders should never reach `needs_reply` status; deterministic rules are faster, cheaper, and independently testable. |
| 2026-06-12 | Gate lead scoring and sales classification behind the user mode; now derived from `Tenant.salesCrmEnabled`. | Baseline users were receiving irrelevant business/sales AI behavior and prompt framing. |
| 2026-06-12 | Store all classification metadata in `ConversationState.metadataJson` as a free-form JSON blob. | Avoids schema churn for evolving classification fields; existing rows without a field fall through to current defaults. |
| 2026-06-12 | Reply-style learning falls back to Gmail SENT history when DB outbound sample count < 5. | Freshly-connected accounts had zero outbound DB rows; immediate failure was confusing. |
| 2026-06-14 | Walk the full MIME tree for email body extraction; keep `text/html` for rendering, `text/plain` for AI. | Single-part HTML messages were stored as escaped text; newsletter CSS junk was appearing in previews and AI prompts. |
| 2026-06-14 | Force light-mode color scheme in the sandboxed iframe. | Dark-mode email templates were rendering black when Gmail shows them light. |
| 2026-06-15 | Store local user intent separately from raw Gmail state. | The Mark Done resurrection bug showed that sync/provider state and local intent were sharing too much surface. Explicit user actions now always win. |
| 2026-06-15 | Add AI usage policy: deterministic rules handle low-value mail first; LLM extraction is skipped or cached. | Reduces AI cost for notification/newsletter mail and prevents eager rich-AI regeneration on every conversation open. |
| 2026-06-16 | OTP/security/reset action items expire by explicit text patterns and default TTLs; can be manually dismissed. | Needs Action was showing stale security codes long after they expired. |
| 2026-06-17 | Gmail push events are persisted with Pub/Sub message ID idempotency before any sync work begins. | Duplicate push deliveries were triggering duplicate syncs. |
| 2026-06-18 | Outlook delta cursor URL is encrypted at rest as `deltaLinkEncrypted`. | The cursor URL is an opaque Microsoft-issued token that may contain routing information. |
| 2026-06-18 | Outlook sync lease uses a random owner ID (`syncLeaseId`); release requires the same ID. | Prevents a stale worker from clearing a newer worker's lock — the gap that was possible with the simpler boolean lease used by earlier designs. |
| 2026-06-18 | Outlook webhook only queues `OutlookSyncEvent` hints; Graph sync happens in cron, not inline. | Webhook response time must be < 5 s or Microsoft retries. Delta sync can take much longer for large mailboxes. |
| 2026-06-24 | Block remote images by default; allow per-message explicit load without persisting the choice. | Remote image loads expose the user's IP and confirm email opens to senders. Per-message explicit load keeps the UX practical without making the choice permanent. |
| 2026-06-24 | `invalid_grant` sets `lastSyncStatus: "needs_reauth"` and stops auto-polling. | Silent retry loop was burning background requests every 15 minutes while showing a stale "synced 5 days ago" timestamp. |
| 2026-06-25 | Reposition FlowDesk as a Gmail-native AI email operator, with the website as the control room. | Users already live in Gmail; projecting labels/drafts/actions into Gmail reduces switching cost while keeping FlowDesk trustworthy and configurable. |
| 2026-06-25 | Add canonical `FlowDesk/*` Gmail labels and queue label projection through `GmailWritebackQueue`. | User-facing Gmail labels are the visible projection of FlowDesk state; queueing keeps writes retryable, auditable, and safe. |
| 2026-07-06 | Execute queued agent jobs through a bounded cron worker without loosening autopilot gates. | Follow-up and lead-sequence work needs to drain reliably, but sending must stay opt-in, policy-gated, budget-gated, and auditable. |
| 2026-07-06 | Hide unsupported reply CC/BCC fields until the send APIs can honor them. | Showing controls that are silently dropped creates trust debt; re-enable them only with end-to-end send support. |
| 2026-07-06 | Treat AI budget and metering as required at every OpenAI entry point. | Inbox chat, rule compilation, drafts, scoring, memory, and summaries should fail predictably and respect tenant limits. |
| 2026-07-06 | Keep landing-page assets local and committed. | Expiring design-tool URLs made the site brittle; committed assets keep production rendering stable. |
| 2026-07-07 | Refocus the roadmap on the trustworthy core loop before new features. | The Gmail-native foundations are built but the loop isn't reliable end-to-end: labels are created without being applied to threads, and "Mark done" doesn't stick on refresh. Correctness is the gate for everything else. |
| 2026-07-07 | Reaffirm the dual-surface framing: Gmail primary, web app secondary but held to a high quality bar. | Most users interact through Gmail, so the Gmail-native side must work really well; the web app is where users configure and supervise and must still look and work like a real product, not a bare control room. |
| 2026-07-07 | The "Mark Done resurrection" class of bug reappeared via the command-center recompute path. | The 2026-06-15 fix separated local intent from provider state, but the home view still re-derives priority every render with draft-ready/re-classification evaluated before the explicit user state. Persisted user state must be the highest-priority signal, not one input among many. |
| 2026-07-07 | De-scope Outlook, CC/BCC, inline-image backfill, and add-on/extension work until Phases 1–2 land. | These are distractions from the core loop and web-app polish; parked under `docs/TODO.md` → "Later / de-scoped". |

## Open product questions

- Which first paid persona matters most for the Gmail-native wedge: personal chief of staff, local business revenue inbox, or team support desk?
- Should FlowDesk stay Gmail-only until PMF, or keep Outlook parity as a trust/enterprise requirement?
- What default automation level should new users start with: labels-only or labels plus Gmail drafts?
- What minimum audit trail makes Gmail-native automation feel safe without becoming noisy?
- Should `Lead` be generic or opinionated toward a first niche (tutors, clinics, agencies, salons)?
- What actions should be allowed in free accounts versus paid accounts?
- How much user-visible explanation is enough before automation feels noisy?
- Which integrations are required for the first paid wedge: calendar, Stripe, Calendly, Drive, Notion, or CRM?
- How much relationship-memory automation should run proactively versus lazily for privacy and cost reasons?
- How should users correct the agent when classification or memory is wrong?
