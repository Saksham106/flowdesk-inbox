import { prisma } from "@/lib/prisma"

export type DataRetentionResult = {
  ok: true
  auditLogsDeleted: number
  aiUsageEventsDeleted: number
  gmailPushEventsDeleted: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const AUDIT_LOG_RETENTION_DAYS = 30
// Must stay longer than a full calendar month: lib/ai/budget.ts aggregates
// AiUsageEvent from the start of the current month for spend limits.
const AI_USAGE_RETENTION_DAYS = 90
const GMAIL_PUSH_EVENT_RETENTION_DAYS = 30

function cutoff(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

// Prunes unbounded operational tables so they plateau at a rolling window
// instead of growing forever. These are per-action receipts, not product
// data — the 2026-07-12 outage was this class of data filling the volume.
export async function runDataRetentionCron(): Promise<DataRetentionResult> {
  const [audit, usage, push] = await Promise.all([
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff(AUDIT_LOG_RETENTION_DAYS) } },
    }),
    prisma.aiUsageEvent.deleteMany({
      where: { createdAt: { lt: cutoff(AI_USAGE_RETENTION_DAYS) } },
    }),
    prisma.gmailPushEvent.deleteMany({
      where: { createdAt: { lt: cutoff(GMAIL_PUSH_EVENT_RETENTION_DAYS) } },
    }),
  ])

  return {
    ok: true,
    auditLogsDeleted: audit.count,
    aiUsageEventsDeleted: usage.count,
    gmailPushEventsDeleted: push.count,
  }
}
