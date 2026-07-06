import { prisma } from "@/lib/prisma"
import { runAgentJob } from "@/lib/agent/jobs"

const BATCH_SIZE = 25
const STALE_SWEEP_SIZE = 200
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export const STALE_JOB_ERROR = "stale_at_executor_launch"

export type AgentJobExecutorSummary = {
  processed: number
  succeeded: number
  failed: number
  skippedStale: number
}

export async function processAgentJobWork(): Promise<AgentJobExecutorSummary> {
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS)

  const skippedStale = await failStaleJobs(staleCutoff, now)

  // Per-tenant fairness: pull each backlogged tenant's oldest jobs and
  // interleave round-robin, so one tenant's backlog cannot starve the rest.
  const tenantRows = await prisma.agentJob.findMany({
    where: { status: "pending", createdAt: { gte: staleCutoff } },
    distinct: ["tenantId"],
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { tenantId: true },
  })

  const perTenant = await Promise.all(
    tenantRows.map((row) =>
      prisma.agentJob.findMany({
        where: { tenantId: row.tenantId, status: "pending", createdAt: { gte: staleCutoff } },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true },
      })
    )
  )

  const batch: { id: string }[] = []
  for (let round = 0; batch.length < BATCH_SIZE; round++) {
    let pushedAny = false
    for (const jobs of perTenant) {
      if (round >= jobs.length) continue
      batch.push(jobs[round])
      pushedAny = true
      if (batch.length >= BATCH_SIZE) break
    }
    if (!pushedAny) break
  }

  let processed = 0
  let succeeded = 0
  let failed = 0

  for (const job of batch) {
    // Atomic pending → running claim so overlapping invocations never
    // double-run a job (same lease pattern as gmail-sync/outlook-worker).
    const claim = await prisma.agentJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "running", startedAt: new Date() },
    })
    if (claim.count !== 1) continue

    processed++
    try {
      const result = await runAgentJob(job.id)
      if (result.status === "completed") {
        succeeded++
      } else {
        failed++
      }
    } catch (err) {
      // runAgentJob persists its own failures; this covers errors thrown
      // before its internal try/catch so one job never aborts the batch.
      failed++
      const error = err instanceof Error ? err.message : "Unknown error"
      await prisma.agentJob
        .update({
          where: { id: job.id },
          data: { status: "failed", completedAt: new Date(), error },
        })
        .catch(() => undefined)
    }
  }

  return { processed, succeeded, failed, skippedStale }
}

// Months of pending jobs accumulated while nothing executed them (audit
// P1-1). Classifying or auto-replying to weeks-old email would be harmful,
// so anything older than 7 days is bulk-failed instead of executed. Bounded
// per run; repeated invocations drain the backlog without a manual migration.
async function failStaleJobs(staleCutoff: Date, now: Date): Promise<number> {
  const stale = await prisma.agentJob.findMany({
    where: { status: "pending", createdAt: { lt: staleCutoff } },
    orderBy: { createdAt: "asc" },
    take: STALE_SWEEP_SIZE,
    select: { id: true, tenantId: true },
  })
  if (stale.length === 0) return 0

  const result = await prisma.agentJob.updateMany({
    where: { id: { in: stale.map((job) => job.id) }, status: "pending" },
    data: { status: "failed", completedAt: now, error: STALE_JOB_ERROR },
  })

  const byTenant = new Map<string, number>()
  for (const job of stale) {
    byTenant.set(job.tenantId, (byTenant.get(job.tenantId) ?? 0) + 1)
  }
  for (const [tenantId, count] of byTenant) {
    await prisma.auditLog
      .create({
        data: {
          tenantId,
          action: "agent_job.stale_bulk_failed",
          payloadJson: { count, error: STALE_JOB_ERROR },
        },
      })
      .catch(() => undefined)
  }

  return result.count
}
