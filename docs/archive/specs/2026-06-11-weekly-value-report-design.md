# Weekly Value Report — Design

Date: 2026-06-11

## Problem

FlowDesk does work in the background (drafting, triaging, extracting tasks, detecting leads, queueing follow-ups), but users never see the aggregate value. The master plan calls a weekly value report a Phase 1 requirement and the packaging plan depends on making value visible ("This week FlowDesk handled 186 emails… saved you an estimated 4.3 hours"). It was the only Phase 1 feature with zero implementation.

## Goal

A `/reports` page that answers "what did FlowDesk do for me this week?" with honest, deterministic numbers computed from records that already exist — no new tracking pipeline, no migration.

## Metrics

All counted over a rolling 7-day window ending now:

| Metric | Source |
|---|---|
| Replies drafted | `Draft.createdAt` (tenant via conversation) |
| Replies sent | `Draft.status = sent`, `updatedAt` |
| Tasks extracted | `InboxTask.createdAt` |
| Tasks closed | `InboxTask.status = closed`, `updatedAt` |
| Leads detected | `Lead.createdAt` |
| Follow-ups queued | `AgentJob.trigger in (follow_up, lead_follow_up)`, `createdAt` |
| Approvals decided | `ApprovalRequest.decidedAt` |
| Conversations triaged | `ConversationState.updatedAt` |

## Time-Saved Estimate

Deliberately conservative fixed weights, shown transparently in the UI:

- 4 min per draft, 3 min per follow-up, 2 min per extracted task, 5 min per detected lead.
- Sent drafts, closed tasks, approvals, and triage are **not** double-counted toward time saved.

## Architecture

- `lib/agent/value-report.ts` — `getReportPeriod`, `estimateMinutesSaved` (pure), `buildWeeklyValueReport(tenantId, now?)` (8 parallel tenant-scoped counts).
- `app/reports/page.tsx` — server component; headline sentence, metric cards, time-saved card; explains the estimate weights inline.
- Inbox nav (desktop and mobile) gains a Reports link.

## Out Of Scope

- Persisted `ValueMetric` snapshots and trends over time.
- Emailed weekly digest of the report.
- Revenue attribution and full ROI dashboard (Phase 2 feature #32).
