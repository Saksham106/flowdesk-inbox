# v2.3 ROI Analytics + Money Impact Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted weekly snapshots + trend bars + pipeline value to `/reports`, and add a Revenue at Risk section + revenue-weighted sort to the command center.

**Architecture:** New `ValueSnapshot` Prisma model stores weekly metric snapshots via a cron; `lib/agent/value-report.ts` gains `buildValueSnapshot`/`getWeeklyTrend`; new `lib/agent/revenue-at-risk.ts` queries stale high-value lead conversations; `/reports` and `CommandCenterPanel` surface both.

**Tech Stack:** Next.js 14 App Router (server components), Prisma ORM, Vitest, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-06-12-roi-analytics-money-impact-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `ValueSnapshot` model + relation on `Tenant` |
| `lib/agent/value-report.ts` | Modify | Extract `fetchValueCounts`, add `getWeekEnding`, `buildValueSnapshot`, `getWeeklyTrend` |
| `lib/agent/revenue-at-risk.ts` | Create | `analyzeRevenueAtRisk` DB query — stale high-value lead conversations |
| `lib/agent/command-center.ts` | Modify | Add `estimatedValue` to `CommandCenterConversation`, revenue-weighted `score()` |
| `app/api/cron/value-snapshot/route.ts` | Create | Weekly cron — upserts a `ValueSnapshot` row per tenant |
| `app/reports/page.tsx` | Modify | Trend bars, pipeline value summary, revenue opportunities this week |
| `app/inbox/CommandCenterPanel.tsx` | Modify | Revenue at Risk subsection above opportunity cards |
| `app/inbox/page.tsx` | Modify | Fetch `revenueAtRisk` + pass to panel; add `estimatedValue` to leads select |
| `tests/value-report.test.ts` | Modify | Tests for `getWeekEnding`, `buildValueSnapshot`, `getWeeklyTrend` |
| `tests/value-snapshot-cron.test.ts` | Create | Test cron auth + iteration |
| `tests/revenue-at-risk.test.ts` | Create | Tests for `analyzeRevenueAtRisk` |
| `tests/command-center.test.ts` | Modify | Tests for `estimatedValue` field + revenue score bonus |

---

## Task 1: Create v2.3 branch

**Files:**
- (git only)

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/v2.3-roi-analytics
```

Expected: `Switched to a new branch 'feat/v2.3-roi-analytics'`

---

## Task 2: Add ValueSnapshot to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the ValueSnapshot model and Tenant relation**

In `prisma/schema.prisma`, add after the `Lead` model block:

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

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, weekEnding])
  @@index([tenantId, weekEnding])
}
```

In the `model Tenant` block, add after the `leads Lead[]` line:

```prisma
  valueSnapshots        ValueSnapshot[]
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add_value_snapshot
```

Expected output includes: `✔ Generated Prisma Client` and `The following migration(s) have been applied`.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add ValueSnapshot model for weekly ROI trend storage"
```

---

## Task 3: Extend value-report.ts — getWeekEnding, buildValueSnapshot, getWeeklyTrend

**Files:**
- Modify: `lib/agent/value-report.ts`
- Modify: `tests/value-report.test.ts`

- [ ] **Step 1: Add three new mock factories to the existing `vi.hoisted` block**

In `tests/value-report.test.ts`, find the `vi.hoisted(() => ({` block and add the three new entries:

```typescript
const {
  mockDraftCount,
  mockTaskCount,
  mockLeadCount,
  mockJobCount,
  mockApprovalCount,
  mockStateCount,
  mockLeadAggregate,      // add
  mockSnapshotUpsert,     // add
  mockSnapshotFindMany,   // add
} = vi.hoisted(() => ({
  mockDraftCount:       vi.fn(),
  mockTaskCount:        vi.fn(),
  mockLeadCount:        vi.fn(),
  mockJobCount:         vi.fn(),
  mockApprovalCount:    vi.fn(),
  mockStateCount:       vi.fn(),
  mockLeadAggregate:    vi.fn(),   // add
  mockSnapshotUpsert:   vi.fn(),   // add
  mockSnapshotFindMany: vi.fn(),   // add
}))
```

- [ ] **Step 2: Extend the `vi.mock('@/lib/prisma', ...)` factory**

Replace the existing `vi.mock('@/lib/prisma', ...)` block with:

```typescript
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft:             { count: mockDraftCount },
    inboxTask:         { count: mockTaskCount },
    lead:              { count: mockLeadCount, aggregate: mockLeadAggregate },
    agentJob:          { count: mockJobCount },
    approvalRequest:   { count: mockApprovalCount },
    conversationState: { count: mockStateCount },
    valueSnapshot:     { upsert: mockSnapshotUpsert, findMany: mockSnapshotFindMany },
  },
}))
```

- [ ] **Step 3: Extend the existing import from `@/lib/agent/value-report`**

Find the existing import statement and add the three new exports:

```typescript
import {
  getReportPeriod,
  estimateMinutesSaved,
  buildWeeklyValueReport,
  getWeekEnding,          // add
  buildValueSnapshot,     // add
  getWeeklyTrend,         // add
  MINUTES_PER_DRAFT,
  MINUTES_PER_FOLLOW_UP,
  MINUTES_PER_TASK,
  MINUTES_PER_LEAD,
} from '@/lib/agent/value-report'
```

- [ ] **Step 4: Append the new test blocks to `tests/value-report.test.ts`**

```typescript
// ---------------------------------------------------------------------------
// getWeekEnding
// ---------------------------------------------------------------------------

describe('getWeekEnding', () => {
  it('returns the following Sunday at UTC midnight for a mid-week date', () => {
    // 2026-06-11 is a Thursday
    const result = getWeekEnding(new Date('2026-06-11T14:00:00Z'))
    expect(result.toISOString()).toBe('2026-06-14T00:00:00.000Z') // Sunday
  })

  it('returns the same day at UTC midnight when today is Sunday', () => {
    // 2026-06-14 is a Sunday
    const result = getWeekEnding(new Date('2026-06-14T08:00:00Z'))
    expect(result.toISOString()).toBe('2026-06-14T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// buildValueSnapshot
// ---------------------------------------------------------------------------

describe('buildValueSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftCount.mockResolvedValue(0)
    mockTaskCount.mockResolvedValue(0)
    mockLeadCount.mockResolvedValue(0)
    mockJobCount.mockResolvedValue(0)
    mockApprovalCount.mockResolvedValue(0)
    mockStateCount.mockResolvedValue(0)
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: 0 } })
    mockSnapshotUpsert.mockResolvedValue({})
  })

  it('upserts a snapshot with correct weekEnding and pipelineValue', async () => {
    // Thursday 2026-06-11 → weekEnding Sunday 2026-06-14
    mockDraftCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    mockTaskCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    mockLeadCount.mockResolvedValue(4)
    mockJobCount.mockResolvedValue(5)
    mockApprovalCount.mockResolvedValue(2)
    mockStateCount.mockResolvedValue(30)
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: 8500 } })

    await buildValueSnapshot(TENANT, new Date('2026-06-11T12:00:00Z'))

    expect(mockSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_weekEnding: {
            tenantId: TENANT,
            weekEnding: new Date('2026-06-14T00:00:00.000Z'),
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          draftsCreated: 3,
          leadsDetected: 4,
          pipelineValue: 8500,
        }),
        update: expect.objectContaining({
          draftsCreated: 3,
          pipelineValue: 8500,
        }),
      })
    )
  })

  it('uses 0 for pipelineValue when aggregate returns null', async () => {
    mockLeadAggregate.mockResolvedValue({ _sum: { estimatedValue: null } })
    await buildValueSnapshot(TENANT, NOW)
    expect(mockSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pipelineValue: 0 }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// getWeeklyTrend
// ---------------------------------------------------------------------------

describe('getWeeklyTrend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns snapshots in ascending weekEnding order', async () => {
    const snapshots = [
      { id: 's2', weekEnding: new Date('2026-06-14T00:00:00Z') },
      { id: 's1', weekEnding: new Date('2026-06-07T00:00:00Z') },
    ]
    mockSnapshotFindMany.mockResolvedValue(snapshots)

    const result = await getWeeklyTrend(TENANT, 4)

    expect(mockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT },
        orderBy: { weekEnding: 'desc' },
        take: 4,
      })
    )
    // returned in ascending order
    expect(result[0].id).toBe('s1')
    expect(result[1].id).toBe('s2')
  })

  it('defaults to 4 weeks', async () => {
    mockSnapshotFindMany.mockResolvedValue([])
    await getWeeklyTrend(TENANT)
    expect(mockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 })
    )
  })
})
```

- [ ] **Step 5: Run tests to confirm they fail**

```bash
npx vitest run tests/value-report.test.ts
```

Expected: fails with "getWeekEnding is not a function" or similar import errors.

- [ ] **Step 6: Implement the new functions in lib/agent/value-report.ts**

Replace the entire file with:

```typescript
import { prisma } from "@/lib/prisma"

const DAY_MS = 24 * 60 * 60 * 1000

export const MINUTES_PER_DRAFT = 4
export const MINUTES_PER_FOLLOW_UP = 3
export const MINUTES_PER_TASK = 2
export const MINUTES_PER_LEAD = 5

export type ValueReportCounts = {
  draftsCreated: number
  draftsSent: number
  tasksExtracted: number
  tasksClosed: number
  leadsDetected: number
  followUpsQueued: number
  approvalsDecided: number
  conversationsTriaged: number
}

export type WeeklyValueReport = ValueReportCounts & {
  periodStart: Date
  periodEnd: Date
  estimatedMinutesSaved: number
}

export function getReportPeriod(now: Date = new Date()): { start: Date; end: Date } {
  return { start: new Date(now.getTime() - 7 * DAY_MS), end: now }
}

export function estimateMinutesSaved(counts: ValueReportCounts): number {
  return (
    counts.draftsCreated * MINUTES_PER_DRAFT +
    counts.followUpsQueued * MINUTES_PER_FOLLOW_UP +
    counts.tasksExtracted * MINUTES_PER_TASK +
    counts.leadsDetected * MINUTES_PER_LEAD
  )
}

export function getWeekEnding(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun, 1=Mon ... 6=Sat
  const daysToAdd = day === 0 ? 0 : 7 - day
  d.setUTCDate(d.getUTCDate() + daysToAdd)
  return d
}

async function fetchValueCounts(
  tenantId: string,
  now: Date
): Promise<ValueReportCounts> {
  const { start, end } = getReportPeriod(now)
  const window = { gte: start, lt: end }

  const [
    draftsCreated,
    draftsSent,
    tasksExtracted,
    tasksClosed,
    leadsDetected,
    followUpsQueued,
    approvalsDecided,
    conversationsTriaged,
  ] = await Promise.all([
    prisma.draft.count({
      where: { conversation: { tenantId }, createdAt: window },
    }),
    prisma.draft.count({
      where: { conversation: { tenantId }, status: "sent", updatedAt: window },
    }),
    prisma.inboxTask.count({
      where: { tenantId, createdAt: window },
    }),
    prisma.inboxTask.count({
      where: { tenantId, status: "closed", updatedAt: window },
    }),
    prisma.lead.count({
      where: { tenantId, createdAt: window },
    }),
    prisma.agentJob.count({
      where: {
        tenantId,
        trigger: { in: ["follow_up", "lead_follow_up"] },
        createdAt: window,
      },
    }),
    prisma.approvalRequest.count({
      where: { tenantId, decidedAt: window },
    }),
    prisma.conversationState.count({
      where: { tenantId, updatedAt: window },
    }),
  ])

  return {
    draftsCreated,
    draftsSent,
    tasksExtracted,
    tasksClosed,
    leadsDetected,
    followUpsQueued,
    approvalsDecided,
    conversationsTriaged,
  }
}

export async function buildWeeklyValueReport(
  tenantId: string,
  now: Date = new Date()
): Promise<WeeklyValueReport> {
  const { start, end } = getReportPeriod(now)
  const counts = await fetchValueCounts(tenantId, now)
  return {
    ...counts,
    periodStart: start,
    periodEnd: end,
    estimatedMinutesSaved: estimateMinutesSaved(counts),
  }
}

export async function buildValueSnapshot(
  tenantId: string,
  now: Date = new Date()
) {
  const counts = await fetchValueCounts(tenantId, now)
  const minutesSaved = estimateMinutesSaved(counts)

  const agg = await prisma.lead.aggregate({
    where: { tenantId, stage: { not: "closed" } },
    _sum: { estimatedValue: true },
  })
  const pipelineValue = agg._sum.estimatedValue ?? 0
  const weekEnding = getWeekEnding(now)

  return prisma.valueSnapshot.upsert({
    where: { tenantId_weekEnding: { tenantId, weekEnding } },
    create: { tenantId, weekEnding, ...counts, estimatedMinutesSaved: minutesSaved, pipelineValue },
    update: { ...counts, estimatedMinutesSaved: minutesSaved, pipelineValue },
  })
}

export async function getWeeklyTrend(tenantId: string, weeks = 4) {
  const snapshots = await prisma.valueSnapshot.findMany({
    where: { tenantId },
    orderBy: { weekEnding: "desc" },
    take: weeks,
  })
  return snapshots.reverse()
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/value-report.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/agent/value-report.ts tests/value-report.test.ts
git commit -m "feat: add getWeekEnding, buildValueSnapshot, getWeeklyTrend to value-report"
```

---

## Task 4: Weekly value-snapshot cron

**Files:**
- Create: `app/api/cron/value-snapshot/route.ts`
- Create: `tests/value-snapshot-cron.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/value-snapshot-cron.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockBuildValueSnapshot, mockTenantFindMany } = vi.hoisted(() => ({
  mockBuildValueSnapshot: vi.fn(),
  mockTenantFindMany: vi.fn(),
}))

vi.mock('@/lib/agent/value-report', () => ({
  buildValueSnapshot: mockBuildValueSnapshot,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findMany: mockTenantFindMany },
  },
}))

const CRON_SECRET = 'test-secret'

async function callRoute(authHeader?: string) {
  process.env.CRON_SECRET = CRON_SECRET
  const { POST } = await import('@/app/api/cron/value-snapshot/route')
  const req = new Request('http://localhost/api/cron/value-snapshot', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
  return POST(req)
}

describe('POST /api/cron/value-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }])
    mockBuildValueSnapshot.mockResolvedValue({})
  })

  it('returns 401 when auth header is missing', async () => {
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it('returns 401 when auth header is wrong', async () => {
    const res = await callRoute('Bearer wrong-secret')
    expect(res.status).toBe(401)
  })

  it('snapshots each tenant and returns count', async () => {
    const res = await callRoute(`Bearer ${CRON_SECRET}`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.snapshotted).toBe(2)
    expect(mockBuildValueSnapshot).toHaveBeenCalledTimes(2)
    expect(mockBuildValueSnapshot).toHaveBeenCalledWith('tenant-1')
    expect(mockBuildValueSnapshot).toHaveBeenCalledWith('tenant-2')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/value-snapshot-cron.test.ts
```

Expected: fails with module-not-found or similar.

- [ ] **Step 3: Create the cron route**

Create `app/api/cron/value-snapshot/route.ts`:

```typescript
import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { buildValueSnapshot } from "@/lib/agent/value-report"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let snapshotted = 0
    for (const tenant of tenants) {
      await buildValueSnapshot(tenant.id)
      snapshotted++
    }
    return NextResponse.json({ ok: true, snapshotted })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run tests/value-snapshot-cron.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/value-snapshot/route.ts tests/value-snapshot-cron.test.ts
git commit -m "feat: add weekly value-snapshot cron endpoint"
```

---

## Task 5: Revenue at Risk analyzer

**Files:**
- Create: `lib/agent/revenue-at-risk.ts`
- Create: `tests/revenue-at-risk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/revenue-at-risk.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockLeadFindMany } = vi.hoisted(() => ({
  mockLeadFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findMany: mockLeadFindMany },
  },
}))

import { analyzeRevenueAtRisk } from '@/lib/agent/revenue-at-risk'

const TENANT = 'tenant-1'
const NOW = new Date('2026-06-12T12:00:00Z')

function makeLead(overrides: {
  estimatedValue?: number
  stage?: string
  lastMessageAt?: Date
  draftStatus?: string | null
  name?: string
  conversationId?: string
}) {
  return {
    estimatedValue: overrides.estimatedValue ?? 2000,
    stage: overrides.stage ?? 'qualified',
    conversationId: overrides.conversationId ?? 'conv-1',
    conversation: {
      lastMessageAt: overrides.lastMessageAt ?? new Date('2026-06-08T12:00:00Z'),
      contact: { name: overrides.name ?? 'Alice' },
      draft: overrides.draftStatus !== undefined ? { status: overrides.draftStatus } : null,
    },
  }
}

describe('analyzeRevenueAtRisk', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns mapped items sorted by estimatedValue descending', async () => {
    mockLeadFindMany.mockResolvedValue([
      makeLead({ estimatedValue: 5000, name: 'Big Deal', conversationId: 'conv-1' }),
      makeLead({ estimatedValue: 1500, name: 'Smaller Deal', conversationId: 'conv-2' }),
    ])

    const result = await analyzeRevenueAtRisk(TENANT, NOW)

    expect(result).toHaveLength(2)
    expect(result[0].contactName).toBe('Big Deal')
    expect(result[0].estimatedValue).toBe(5000)
    expect(result[0].conversationId).toBe('conv-1')
    expect(result[0].daysSinceLastMessage).toBe(4) // 2026-06-08 → 2026-06-12
  })

  it('queries with correct tenantId and orders by estimatedValue desc', async () => {
    mockLeadFindMany.mockResolvedValue([])
    await analyzeRevenueAtRisk(TENANT, NOW)

    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
        orderBy: { estimatedValue: 'desc' },
        take: 5,
      })
    )
  })

  it('returns empty array when no leads match', async () => {
    mockLeadFindMany.mockResolvedValue([])
    const result = await analyzeRevenueAtRisk(TENANT, NOW)
    expect(result).toEqual([])
  })

  it('falls back to "Unknown" when contact is null', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        estimatedValue: 3000,
        stage: 'proposal',
        conversationId: 'conv-3',
        conversation: {
          lastMessageAt: new Date('2026-06-08T00:00:00Z'),
          contact: null,
          draft: null,
        },
      },
    ])
    const result = await analyzeRevenueAtRisk(TENANT, NOW)
    expect(result[0].contactName).toBe('Unknown')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/revenue-at-risk.test.ts
```

Expected: fails with module not found.

- [ ] **Step 3: Create the analyzer**

Create `lib/agent/revenue-at-risk.ts`:

```typescript
import { prisma } from "@/lib/prisma"

const DAY_MS = 24 * 60 * 60 * 1000
const STALENESS_DAYS = 3

export type RevenueAtRiskItem = {
  conversationId: string
  contactName: string
  estimatedValue: number
  daysSinceLastMessage: number
  stage: string
}

export async function analyzeRevenueAtRisk(
  tenantId: string,
  now: Date = new Date()
): Promise<RevenueAtRiskItem[]> {
  const cutoff = new Date(now.getTime() - STALENESS_DAYS * DAY_MS)

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      estimatedValue: { gt: 0 },
      conversation: { lastMessageAt: { lt: cutoff } },
    },
    select: {
      estimatedValue: true,
      stage: true,
      conversationId: true,
      conversation: {
        select: {
          lastMessageAt: true,
          contact: { select: { name: true } },
          draft: { select: { status: true } },
        },
      },
    },
    orderBy: { estimatedValue: "desc" },
    take: 5,
  })

  return leads
    .filter(
      (l) => !l.conversation.draft || l.conversation.draft.status === "sent"
    )
    .map((l) => ({
      conversationId: l.conversationId,
      contactName: l.conversation.contact?.name ?? "Unknown",
      estimatedValue: l.estimatedValue!,
      daysSinceLastMessage: Math.floor(
        (now.getTime() - l.conversation.lastMessageAt.getTime()) / DAY_MS
      ),
      stage: l.stage,
    }))
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/revenue-at-risk.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/revenue-at-risk.ts tests/revenue-at-risk.test.ts
git commit -m "feat: add analyzeRevenueAtRisk — stale high-value lead conversations"
```

---

## Task 6: Add estimatedValue to CommandCenterConversation + revenue score

**Files:**
- Modify: `lib/agent/command-center.ts`
- Modify: `tests/command-center.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/command-center.test.ts` (after the existing test blocks):

```typescript
describe('estimatedValue in CommandCenterConversation', () => {
  it('populates estimatedValue from lead when conversation is an opportunity', () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        label: 'Lead',
        lead: { score: 55, scoreExplanation: 'High intent', estimatedValue: 3000 },
      }),
      now
    )
    expect(result.estimatedValue).toBe(3000)
  })

  it('sets estimatedValue to null when no lead exists', () => {
    const result = analyzeConversationForCommandCenter(conversation(), now)
    expect(result.estimatedValue).toBeNull()
  })
})

describe('revenue-weighted score()', () => {
  it('a high-value opportunity outranks a zero-value opportunity in topActions', () => {
    const highValue = conversation({
      id: 'conv-high',
      label: 'Lead',
      lead: { score: 60, scoreExplanation: 'Budget confirmed', estimatedValue: 10000 },
    })
    const noValue = conversation({
      id: 'conv-low',
      label: 'Lead',
      lead: { score: 60, scoreExplanation: 'Inquiry only', estimatedValue: 0 },
    })
    const center = buildDailyCommandCenter([highValue, noValue], now)
    const ids = center.topActions.map((a) => a.id)
    expect(ids.indexOf('conv-high')).toBeLessThan(ids.indexOf('conv-low'))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/command-center.test.ts
```

Expected: fails on `estimatedValue` being `undefined` and the sort test.

- [ ] **Step 3: Update CommandCenterConversation type**

In `lib/agent/command-center.ts`, find the `CommandCenterConversation` type and add `estimatedValue: number | null`:

```typescript
export type CommandCenterConversation = {
  id: string
  displayName: string
  state: CommandCenterState
  priority: CommandCenterPriority
  reason: string
  nextAction: string
  href: string
  lastMessageAt: Date
  label: string | null
  sensitive: boolean
  approvalReason: string | null
  safelyIgnored: boolean
  needsReply: boolean
  opportunity: boolean
  leadScore: number | null
  estimatedValue: number | null
}
```

- [ ] **Step 4: Add estimatedValue to CommandCenterInputConversation.lead**

Find the `lead?:` field inside `CommandCenterInputConversation` and update it:

```typescript
  lead?: {
    score: number
    scoreExplanation: string | null
    estimatedValue?: number | null
  } | null
```

- [ ] **Step 5: Set estimatedValue in analyzeConversationForCommandCenter**

In the `return { ... }` block at the end of `analyzeConversationForCommandCenter`, add:

```typescript
    estimatedValue: conversation.lead?.estimatedValue ?? null,
```

The full return becomes:

```typescript
  return {
    id: conversation.id,
    displayName: displayName(conversation),
    state,
    priority,
    reason,
    nextAction,
    href: `/conversations/${conversation.id}`,
    lastMessageAt: conversation.lastMessageAt,
    label: conversation.label,
    sensitive,
    approvalReason: approvalReason(conversation),
    safelyIgnored: state === "done" || safelyIgnored,
    needsReply: conversation.status === "needs_reply" && !safelyIgnored,
    opportunity,
    leadScore: opportunity && conversation.lead ? conversation.lead.score : null,
    estimatedValue: conversation.lead?.estimatedValue ?? null,
  }
```

- [ ] **Step 6: Update score() to include revenue bonus**

Find the `function score(conversation: CommandCenterConversation)` at the bottom of `lib/agent/command-center.ts` and replace it:

```typescript
function score(conversation: CommandCenterConversation): number {
  const priorityScore: Record<CommandCenterPriority, number> = {
    urgent: 500,
    high: 400,
    medium: 300,
    low: 200,
    none: 0,
  }
  const revenueBonus = Math.min(Math.floor((conversation.estimatedValue ?? 0) / 200), 50)
  return (
    priorityScore[conversation.priority] +
    (conversation.opportunity ? 25 : 0) +
    (conversation.sensitive ? 20 : 0) +
    (conversation.needsReply ? 10 : 0) +
    (conversation.state === "support" ? 30 : 0) +
    (conversation.state === "sales_qualified" ? 35 : 0) +
    revenueBonus
  )
}
```

This gives up to +50 for leads with $10k+ estimated value (every $200 = +1, capped at 50).

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/command-center.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/agent/command-center.ts tests/command-center.test.ts
git commit -m "feat: add estimatedValue to CommandCenterConversation and revenue-weighted score"
```

---

## Task 7: Upgrade /reports page

**Files:**
- Modify: `app/reports/page.tsx`

No unit tests for server page components — functionality is verified by running the app.

- [ ] **Step 1: Replace app/reports/page.tsx**

```typescript
import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { buildWeeklyValueReport, getWeeklyTrend, getReportPeriod } from "@/lib/agent/value-report"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours.toFixed(1)} hours`
}

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value}`
}

const STAGE_ORDER = ["new", "qualified", "contacted", "proposal", "closing", "won"]
const STAGE_LABELS: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  contacted: "Contacted",
  proposal: "Proposal",
  closing: "Closing",
  won: "Won",
}

const TREND_METRICS: Array<{ key: string; label: string; colorClass: string }> = [
  { key: "draftsCreated", label: "Replies drafted", colorClass: "bg-blue-500" },
  { key: "leadsDetected", label: "Leads detected", colorClass: "bg-emerald-500" },
  { key: "followUpsQueued", label: "Follow-ups queued", colorClass: "bg-violet-500" },
  { key: "approvalsDecided", label: "Approvals decided", colorClass: "bg-amber-500" },
]

export default async function ReportsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenantId = session.user.tenantId

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType === "personal") redirect("/inbox")

  const { start: periodStart } = getReportPeriod()

  const [report, trend, pipelineGroups, recentLeads] = await Promise.all([
    buildWeeklyValueReport(tenantId),
    getWeeklyTrend(tenantId, 4),
    prisma.lead.groupBy({
      by: ["stage"],
      where: { tenantId, stage: { not: "closed" }, estimatedValue: { gt: 0 } },
      _sum: { estimatedValue: true },
      _count: { id: true },
    }),
    prisma.lead.findMany({
      where: { tenantId, createdAt: { gte: periodStart } },
      select: {
        id: true,
        name: true,
        estimatedValue: true,
        score: true,
        scoreExplanation: true,
        conversationId: true,
        stage: true,
      },
      orderBy: { estimatedValue: "desc" },
      take: 6,
    }),
  ])

  const totalPipeline = pipelineGroups.reduce(
    (sum, g) => sum + (g._sum.estimatedValue ?? 0),
    0
  )
  const totalPipelineLeads = pipelineGroups.reduce((sum, g) => sum + g._count.id, 0)

  const pipelineByStage = STAGE_ORDER.map((stage) => {
    const group = pipelineGroups.find((g) => g.stage === stage)
    return {
      stage,
      label: STAGE_LABELS[stage] ?? stage,
      value: group?._sum.estimatedValue ?? 0,
      count: group?._count.id ?? 0,
    }
  }).filter((s) => s.count > 0)

  const headline =
    report.draftsCreated + report.followUpsQueued + report.tasksExtracted + report.leadsDetected > 0
      ? `This week FlowDesk drafted ${report.draftsCreated} repl${report.draftsCreated === 1 ? "y" : "ies"}, queued ${report.followUpsQueued} follow-up${report.followUpsQueued === 1 ? "" : "s"}, extracted ${report.tasksExtracted} task${report.tasksExtracted === 1 ? "" : "s"}, detected ${report.leadsDetected} lead${report.leadsDetected === 1 ? "" : "s"}, and saved you an estimated ${formatMinutes(report.estimatedMinutesSaved)}.`
      : "No agent activity in the last 7 days yet. Connect an inbox and sync to see FlowDesk's work here."

  const metrics: Array<{ label: string; value: number; note: string }> = [
    { label: "Replies drafted", value: report.draftsCreated, note: "AI drafts created" },
    { label: "Replies sent", value: report.draftsSent, note: "approved drafts sent" },
    { label: "Tasks extracted", value: report.tasksExtracted, note: "promises and deadlines captured" },
    { label: "Tasks closed", value: report.tasksClosed, note: "marked done this week" },
    { label: "Leads detected", value: report.leadsDetected, note: "revenue signals found" },
    { label: "Follow-ups queued", value: report.followUpsQueued, note: "stale threads and lead sequences" },
    { label: "Approvals decided", value: report.approvalsDecided, note: "reviewed from the queue" },
    { label: "Conversations triaged", value: report.conversationsTriaged, note: "states kept up to date" },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Weekly value report</h1>
            <p className="text-sm text-slate-500">
              {report.periodStart.toLocaleDateString()} – {report.periodEnd.toLocaleDateString()}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Headline */}
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-900">{headline}</p>
          <p className="mt-2 text-xs text-blue-700">
            Time saved is a conservative estimate: 4 min per draft, 3 min per follow-up, 2 min per
            extracted task, 5 min per detected lead.
          </p>
        </section>

        {/* This-week metrics grid */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-2xl font-semibold text-slate-900">{metric.value}</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{metric.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{metric.note}</p>
            </div>
          ))}
        </section>

        {/* Estimated time saved */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Estimated time saved</h2>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">
            {formatMinutes(report.estimatedMinutesSaved)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Counted over the last 7 days from drafts, follow-ups, tasks, and leads.
          </p>
        </section>

        {/* 4-week trend bars — only shown when 2+ snapshots exist */}
        {trend.length >= 2 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-5 text-sm font-semibold text-slate-700">
              Activity trend (last {trend.length} weeks)
            </h2>
            <div className="space-y-6">
              {TREND_METRICS.map(({ key, label, colorClass }) => {
                const vals = trend.map((s) => (s as Record<string, unknown>)[key] as number ?? 0)
                const max = Math.max(...vals, 1)
                return (
                  <div key={key}>
                    <p className="mb-2 text-xs text-slate-500">{label}</p>
                    <div className="flex items-end gap-3" style={{ height: "56px" }}>
                      {trend.map((snap, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1">
                          <div className="w-full flex items-end" style={{ height: "40px" }}>
                            <div
                              className={`w-full rounded-t ${colorClass} opacity-80`}
                              style={{ height: `${Math.max((vals[i] / max) * 40, 2)}px` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">
                            {snap.weekEnding.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="text-xs font-medium text-slate-600">{vals[i]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Pipeline value summary */}
        {totalPipelineLeads > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">Active pipeline</h2>
            <p className="mt-1 text-3xl font-semibold text-emerald-600">
              {formatCurrency(totalPipeline)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              across {totalPipelineLeads} active lead{totalPipelineLeads === 1 ? "" : "s"}
            </p>
            {pipelineByStage.length > 0 && (
              <div className="mt-4 space-y-2">
                {pipelineByStage.map((s) => (
                  <div key={s.stage} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-slate-500">{s.label}</span>
                    <div className="flex-1 overflow-hidden rounded-full bg-slate-100" style={{ height: "6px" }}>
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{
                          width: totalPipeline > 0 ? `${(s.value / totalPipeline) * 100}%` : "0%",
                        }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs font-medium text-slate-700">
                      {formatCurrency(s.value)} ({s.count})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Revenue opportunities this week */}
        {recentLeads.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Revenue opportunities this week</h2>
            <ul className="divide-y divide-slate-100">
              {recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/conversations/${lead.conversationId}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{lead.name}</p>
                      {lead.scoreExplanation && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {lead.scoreExplanation.slice(0, 90)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {lead.estimatedValue ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          {formatCurrency(lead.estimatedValue)}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          lead.score >= 70
                            ? "bg-emerald-100 text-emerald-700"
                            : lead.score >= 40
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {lead.score}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/reports/page.tsx
git commit -m "feat: upgrade /reports with trend bars, pipeline summary, and revenue opportunities"
```

---

## Task 8: CommandCenterPanel Revenue at Risk + inbox page wiring

**Files:**
- Modify: `app/inbox/CommandCenterPanel.tsx`
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Update CommandCenterPanel to accept and render revenueAtRisk**

Replace `app/inbox/CommandCenterPanel.tsx` with:

```typescript
import Link from "next/link"

import type { DailyCommandCenter } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"

const countItems = [
  ["needsReply", "Needs reply"],
  ["waitingOnThem", "Waiting"],
  ["approvals", "Approvals"],
  ["meetings", "Meetings"],
  ["opportunities", "Opportunities"],
  ["potentialProblems", "Problems"],
  ["support", "Support"],
  ["salesQualified", "Sales Qualified"],
  ["safelyIgnored", "Ignored"],
] as const

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value}`
}

export default function CommandCenterPanel({
  commandCenter,
  revenueAtRisk = [],
}: {
  commandCenter: DailyCommandCenter
  revenueAtRisk?: RevenueAtRiskItem[]
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Today&apos;s Inbox Brief
        </p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-950 sm:text-2xl">
              {commandCenter.headline}
            </h2>
            <p className="mt-0.5 text-sm font-medium text-emerald-700">
              {commandCenter.droppedBallMessage}
            </p>
          </div>
          <Link
            href="/digest"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Open full brief
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:gap-3 sm:px-5 sm:py-4 lg:grid-cols-4">
        {countItems.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 sm:px-3">
            <p className="text-lg font-semibold text-slate-950 sm:text-xl">
              {commandCenter.counts[key]}
            </p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Revenue at Risk subsection */}
      {revenueAtRisk.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 sm:px-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Revenue at Risk
          </p>
          <ul className="space-y-1">
            {revenueAtRisk.map((item) => (
              <li key={item.conversationId}>
                <Link
                  href={`/conversations/${item.conversationId}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-amber-100 transition"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {item.contactName}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      No reply in {item.daysSinceLastMessage}d
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      At Risk
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {formatCurrency(item.estimatedValue)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {commandCenter.topActions.length > 0 ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {commandCenter.topActions.slice(0, 4).map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block px-5 py-3 transition hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.displayName}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">{item.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
                      {item.priority}
                    </span>
                    {item.leadScore !== null && item.leadScore !== undefined ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.leadScore >= 70
                            ? "bg-emerald-100 text-emerald-700"
                            : item.leadScore >= 40
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.leadScore}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-500">
                  {item.nextAction}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
          Nothing needs immediate handling. The rest can stay safely quiet.
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Update inbox/page.tsx — add estimatedValue to leads select and fetch revenueAtRisk**

In `app/inbox/page.tsx`, find the `leads:` include inside the `commandCenterConversations` query and update the select to include `estimatedValue`:

```typescript
        leads: {
          select: { score: true, scoreExplanation: true, estimatedValue: true },
          take: 1,
        },
```

- [ ] **Step 3: Add revenueAtRisk to the Promise.all in inbox/page.tsx**

Add the import at the top of the file (with the other agent imports):

```typescript
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk"
```

In the `Promise.all([...])` destructuring, add `revenueAtRisk` to the list and the call:

```typescript
  const [
    conversations,
    statusCounts,
    commandCenterConversations,
    ignoredStates,
    pendingFollowUps,
    tenant,
    revenueAtRisk,          // add
  ] = await Promise.all([
    // ... existing entries unchanged ...
    analyzeRevenueAtRisk(tenantId),   // add as last entry
  ])
```

- [ ] **Step 4: Pass revenueAtRisk to CommandCenterPanel**

Find `<CommandCenterPanel commandCenter={commandCenter} />` and update:

```typescript
<CommandCenterPanel commandCenter={commandCenter} revenueAtRisk={revenueAtRisk} />
```

- [ ] **Step 5: Run full test suite and type check**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/inbox/CommandCenterPanel.tsx app/inbox/page.tsx
git commit -m "feat: add Revenue at Risk section to command center and wire inbox page"
```

---

## Task 9: Update docs and final verification

**Files:**
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Mark features as Shipped in MASTER_PRODUCT_PLAN.md**

In the Feature Index table, update:
- Feature #32 status from `Partial` to `Shipped`, notes: "Weekly snapshots + 4-week trend bars + pipeline value summary + revenue opportunities on `/reports`."
- Feature #40 status from `Partial` to `Shipped`, notes: "Revenue at Risk section in command center; opportunity sort is revenue-weighted."

Add a Decision Log row:
```
| 2026-06-12 | Ship v2.3: ROI analytics + money impact triage. | ValueSnapshot persists weekly metrics for trend views; analyzeRevenueAtRisk surfaces stale high-value leads; revenue-weighted score in command center topActions. Next: Phase 3 personal chief-of-staff or remaining Phase 2 items (local-business templates). |
```

Update the "Next Slice" section to note v2.3 is shipped and suggest the next priority.

- [ ] **Step 2: Check off TODO.md items**

In `docs/TODO.md` Phase 2 section, mark these as done:
```
- [x] **Email triage by money impact** (#40) — shipped 2026-06-12: Revenue at Risk section in command center; opportunity cards sorted by estimatedValue; revenue bonus in topActions score.
- [x] **Full ROI analytics dashboard** (#32) — shipped 2026-06-12: ValueSnapshot model + weekly cron; 4-week trend bars, pipeline value by stage, revenue opportunities list on `/reports`.
```

- [ ] **Step 3: Run full test suite + build**

```bash
npx vitest run
```

Expected: all tests pass.

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit docs**

```bash
git add docs/MASTER_PRODUCT_PLAN.md docs/TODO.md
git commit -m "docs: mark v2.3 ROI analytics and money impact triage as shipped"
```

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin feat/v2.3-roi-analytics
```

Then open a PR: `feat/v2.3-roi-analytics → main` with title `feat: v2.3 ROI analytics + email triage by money impact`.
