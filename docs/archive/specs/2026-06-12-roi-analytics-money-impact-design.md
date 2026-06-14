# v2.3 Design: ROI Analytics + Email Triage by Money Impact

**Date:** 2026-06-12
**Phase:** 2 — Business Revenue Inbox Agent
**Features:** #32 (Email Analytics / ROI Dashboard), #40 (Email Triage by Money Impact)
**Branch:** feat/v2.3-roi-analytics

## Context

The `/reports` page currently computes a rolling 7-day count of agent activity live from raw records. There is no trend history, no revenue attribution, and no pipeline value summary. The command center surfaces lead score badges on opportunity cards but does not rank by revenue impact or flag stale high-value conversations.

v2.3 adds:
1. Persisted weekly snapshots enabling multi-week trend views on `/reports`.
2. A pipeline value summary and revenue opportunities list on `/reports`.
3. Revenue-weighted sorting and a "Revenue at Risk" subsection in the command center.

## Schema Change

Add one new model to `prisma/schema.prisma`:

```prisma
model ValueSnapshot {
  id                    String   @id @default(cuid())
  tenantId              String
  weekEnding            DateTime
  draftsCreated         Int
  draftsSent            Int
  tasksExtracted        Int
  tasksClosed           Int
  leadsDetected         Int
  followUpsQueued       Int
  approvalsDecided      Int
  conversationsTriaged  Int
  estimatedMinutesSaved Int
  pipelineValue         Float
  createdAt             DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, weekEnding])
  @@index([tenantId, weekEnding])
}
```

`weekEnding` is the Sunday (UTC midnight) that closes the measured 7-day window. The `@@unique` constraint means the cron can safely upsert without duplicates.

`pipelineValue` is the sum of `Lead.estimatedValue` across all active (non-closed) leads for the tenant at snapshot time.

The `Tenant` model gets a corresponding `valueSnapshots ValueSnapshot[]` relation field.

## Backend: value-report.ts additions

Two new exported functions alongside the existing `buildWeeklyValueReport`:

### `buildValueSnapshot(tenantId, now?)`

Computes the current week's `ValueReportCounts`, calculates `estimatedMinutesSaved`, sums `pipelineValue` from active leads, then upserts into `ValueSnapshot` using `weekEnding` = the Sunday that ends the current week (truncated to UTC midnight). Returns the upserted snapshot.

### `getWeeklyTrend(tenantId, weeks?)`

Queries the last `weeks` (default 4) `ValueSnapshot` rows for the tenant ordered by `weekEnding` descending. Returns them in ascending order for rendering. If fewer than `weeks` snapshots exist, returns what is available (no padding — the UI handles sparse data gracefully).

## Cron: `/api/cron/value-snapshot`

New file: `app/api/cron/value-snapshot/route.ts`

- Method: `POST`
- Auth: `x-cron-secret` header matching `process.env.CRON_SECRET` (same pattern as existing cron routes).
- Behavior: fetches all tenant IDs, calls `buildValueSnapshot(tenantId)` for each in series (not parallel — avoids overwhelming the DB on large deployments). Returns `{ snapshotted: N }`.
- Cadence: weekly (Sunday night). Listed in the README cron schedule section alongside existing crons.

## Backend: command-center.ts additions

### `analyzeRevenueAtRisk(tenantId)`

Returns conversations that meet all three conditions:
1. Has an associated `Lead` with `estimatedValue > 0`.
2. Last inbound message is more than 3 days old (no recent reply from the other side).
3. No pending `Draft` exists for the conversation.

Returns an array of `{ conversationId, subject, contactName, estimatedValue, daysSinceLastMessage, stage }` sorted by `estimatedValue` descending, capped at 5 items.

### Opportunity card sort change

The existing opportunity-card builder currently sorts by `score` descending. Change the sort key to `estimatedValue` descending (with `score` as a tiebreaker). This makes the revenue-weighted signal the primary rank.

## Frontend: `/reports` page upgrade

The page keeps its existing "This week" metrics grid. Below it, three new sections are added:

### 4-week trend bars

Rendered as a simple HTML/CSS table — no chart library. Each row is a metric (drafts, leads, follow-ups, approvals). Each column is one weekly snapshot. The bar is a `div` with a percentage-width background color, scaled to the max value in that row across all weeks. If fewer than 2 snapshots exist, the section is hidden (not enough data to trend).

### Pipeline value summary

Queries active leads grouped by stage. Renders: "**$X** across N leads" headline, then a mini horizontal bar per stage (Qualified / Contacted / Proposal / Closing / Won) showing count and sum. Leads with no `estimatedValue` are excluded from the dollar sums but counted in the totals.

### Revenue opportunities this week

A scrollable list (max 6 items) of leads detected in the current 7-day window (`Lead.createdAt >= periodStart`). Each item shows: contact name, estimated value chip, score badge, `scoreExplanation` snippet (first 80 chars), and a link to the conversation. If no leads were detected this week, the section is hidden.

## Frontend: CommandCenterPanel changes

### Revenue at Risk subsection

Added above the existing opportunity cards. Calls `analyzeRevenueAtRisk` on the server and passes results as a prop. Each card shows:
- Amber "At Risk" chip
- Contact name + estimated value
- "No reply in N days" note
- Link to conversation

If the array is empty, the subsection is not rendered.

### Opportunity card sort

The server-side opportunity fetch is updated to sort by `estimatedValue DESC, score DESC` matching the command-center analyzer change.

## Files Changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `ValueSnapshot` model + relation on `Tenant` |
| `lib/agent/value-report.ts` | Add `buildValueSnapshot`, `getWeeklyTrend` |
| `lib/agent/command-center.ts` | Add `analyzeRevenueAtRisk`, update opportunity sort |
| `app/api/cron/value-snapshot/route.ts` | New weekly cron |
| `app/reports/page.tsx` | Trend bars, pipeline summary, revenue opportunities |
| `app/inbox/CommandCenterPanel.tsx` | Revenue at risk section, value-weighted sort |

## Decisions

- **Persisted snapshots over live multi-window queries.** Trend queries on raw records grow O(N) with inbox size. Snapshots are O(weeks). The `ValueMetric` model was already in the data-model roadmap.
- **No chart library.** CSS-only bars keep the bundle small and match the existing reports page aesthetic.
- **3-day staleness threshold for "At Risk."** Matches the follow-up brain's existing staleness signal. Configurable later via tenant settings.
- **Revenue at Risk capped at 5 items.** The command center is a priority surface; flooding it with low-value signals defeats the purpose.
- **pipelineValue in snapshot.** Revenue attribution becomes meaningful only when we can compare pipeline across weeks. Storing it at snapshot time avoids retroactive recalculation as leads change stage.

## Out of Scope for v2.3

- Per-category revenue attribution (e.g., support vs. sales revenue).
- User-configurable staleness thresholds.
- Email-level money-impact scores (beyond lead signal).
- Trend alerting ("leads down 40% this week").
- Local-business concierge templates (#36).
