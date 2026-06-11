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

export async function buildWeeklyValueReport(
  tenantId: string,
  now: Date = new Date()
): Promise<WeeklyValueReport> {
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

  const counts: ValueReportCounts = {
    draftsCreated,
    draftsSent,
    tasksExtracted,
    tasksClosed,
    leadsDetected,
    followUpsQueued,
    approvalsDecided,
    conversationsTriaged,
  }

  return {
    ...counts,
    periodStart: start,
    periodEnd: end,
    estimatedMinutesSaved: estimateMinutesSaved(counts),
  }
}
