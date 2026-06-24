# Product Plan

Last updated: 2026-06-24

## Product thesis

FlowDesk is an AI chief of staff for the inbox: it identifies what matters, explains why, tracks the next action, and safely handles routine work. Trust comes from visible reasoning, user correction, approval gates, audit history, and undo—not from replying to everything automatically.

## Product principles

1. Prioritize obligations, relationships, risk, and revenue over inbox volume.
2. Preserve explicit user intent across provider synchronization and classification.
3. Prefer deterministic handling for routine mail and use richer AI where it adds value.
4. Draft and explain before automating; gate sensitive actions by confidence and risk.
5. Keep connector work incremental, idempotent, bounded, observable, and recoverable.

## Phases

### Foundations and daily control — implemented, still hardening

Command center, attention categories, tasks, follow-ups, approval queue, relationship memory, sensitive detection, drafts, risk radar, and value reporting are available. Current work should improve consistency and explainability rather than add another overlapping inbox surface.

### Revenue inbox — implemented first slices

Lead capture/scoring, sales and support signals, knowledge-backed drafts, follow-up sequences, meeting workflows, pipeline reporting, and revenue-at-risk views exist. Remaining work is product depth, settings, and validation with a clear business persona.

### Personal chief of staff — implemented first slices

Life-admin classification, bills/deadlines, VIPs, snooze, attachment extraction, search, inbox chat, second-brain facts, phishing warnings, and unsubscribe workflows exist. Remaining work is accuracy, retrieval quality, and broader obligation workflows.

### Automations and integrations — implemented foundations

Plain-English rules, autopilot policies, snippets, Clean Inbox, scheduling sessions, automation traces/rollback, workflow templates, Calendar, and Drive foundations exist. Complete the unfinished workflows before expanding connector breadth.

### Team inbox platform — later

Shared inboxes, assignments, comments, collision detection, roles, permissions, SLAs, and team analytics require a dedicated collaboration model and should not be layered onto the single-user foundation piecemeal.

## Current priorities

1. Make classification decisions inspectable and consolidate duplicated heuristics.
2. Add intentional sender/domain rule management while preserving user precedence.
3. Finish provider parity and reliability gaps, including Outlook writeback and Gmail CID images.
4. Complete scheduling, workflow-builder, and connected-context loops already started.
5. Define paid packaging and a primary business persona before building team features.

## Trust and safety invariants

- Legal, financial, health, HR, immigration, security, dispute, and emotionally sensitive messages require human review by default.
- Autopilot remains category-scoped, confidence-gated, auditable, and reversible where possible.
- Agent actions should expose what changed, why, their source, and how to correct them.
- No paid feature may bypass safety policy.

Detailed current capabilities are in [`CURRENT_STATE.md`](CURRENT_STATE.md); concrete remaining work is in [`TODO.md`](TODO.md).
