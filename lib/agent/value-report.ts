import { prisma } from "@/lib/prisma"

const DAY_MS = 24 * 60 * 60 * 1000

// Deterministic per-item estimates of manual effort avoided, in minutes.
// Deliberately conservative so the report never overstates value.
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
  const pipelineValue = Math.round(agg._sum.estimatedValue ?? 0)
  const weekEnding = getWeekEnding(now)

  return prisma.valueSnapshot.upsert({
    where: { tenantId_weekEnding: { tenantId, weekEnding } },
    create: { tenantId, weekEnding, ...counts, estimatedMinutesSaved: minutesSaved, pipelineValue },
    update: { ...counts, estimatedMinutesSaved: minutesSaved, pipelineValue },
  })
}

export type ValueSnapshotCronResult = {
  ok: boolean
  snapshotted: number
  failed: number
}

export async function runValueSnapshotCron(): Promise<ValueSnapshotCronResult> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } })
  let snapshotted = 0
  const errors: string[] = []
  for (const tenant of tenants) {
    try {
      await buildValueSnapshot(tenant.id)
      snapshotted++
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error"
      console.error(`value-snapshot: failed for tenant ${tenant.id}: ${msg}`)
      errors.push(tenant.id)
    }
  }
  return { ok: errors.length === 0, snapshotted, failed: errors.length }
}

export async function getWeeklyTrend(tenantId: string, weeks = 4) {
  const snapshots = await prisma.valueSnapshot.findMany({
    where: { tenantId },
    orderBy: { weekEnding: "desc" },
    take: weeks,
  })
  return snapshots.reverse()
}
