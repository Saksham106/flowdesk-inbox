import { buildJobRegistry, type ScheduledJob } from "@/lib/scheduler/jobs"

export type JobStatus = {
  name: string
  intervalMs: number
  isRunning: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  lastError: string | null
  lastResult: unknown
  runCount: number
  errorCount: number
}

type SchedulerState = {
  statusByJob: Map<string, JobStatus>
  timers: NodeJS.Timeout[]
  started: boolean
}

// Next.js can instantiate this module more than once per process — e.g. the
// instrumentation.ts entry that calls startScheduler() and an API route that
// later calls getSchedulerStatus() may each get their own bundled copy of
// this file's module scope, even within the same `next start` process. A
// plain module-level `let started = false` would make each copy think it's
// the only instance. globalThis is the one thing guaranteed to be the same
// object across every module graph in the process — the identical pattern
// lib/prisma.ts already uses for its PrismaClient singleton.
declare global {
  // eslint-disable-next-line no-var
  var __flowdeskScheduler: SchedulerState | undefined
}

function getState(): SchedulerState {
  if (!global.__flowdeskScheduler) {
    global.__flowdeskScheduler = { statusByJob: new Map(), timers: [], started: false }
  }
  return global.__flowdeskScheduler
}

function initStatus(job: ScheduledJob): JobStatus {
  return {
    name: job.name,
    intervalMs: job.intervalMs,
    isRunning: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: null,
    lastResult: null,
    runCount: 0,
    errorCount: 0,
  }
}

// Runs one job, guarding against overlap (a slow run doesn't get a second
// concurrent invocation from the next tick) and isolating failures (one
// job throwing never takes down the interval or any other job).
async function runOnce(job: ScheduledJob): Promise<void> {
  const status = getState().statusByJob.get(job.name)
  if (!status || status.isRunning) return

  status.isRunning = true
  status.lastStartedAt = new Date().toISOString()
  const startedAt = Date.now()

  try {
    const result = await job.run()
    status.lastResult = result
    status.lastError = null
    status.runCount++
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : "Unknown scheduler job error"
    status.errorCount++
    console.error(`[scheduler] job "${job.name}" failed:`, err)
  } finally {
    status.isRunning = false
    status.lastFinishedAt = new Date().toISOString()
    status.lastDurationMs = Date.now() - startedAt
  }
}

// Starts the in-process job scheduler. Idempotent — calling this more than
// once (e.g. a hot-reload in dev) is a no-op after the first call.
//
// This replaces dependence on an external cron caller hitting the
// CRON_SECRET-gated /api/cron/* routes: those routes still exist (useful for
// manual/on-demand triggering and as a documented interface), but nothing
// external needs to call them for the product to actually work. Set
// SCHEDULER_ENABLED=0 to disable — e.g. if a real external scheduler is
// introduced later, or for a preview/staging process that shouldn't process
// production-shaped background work.
export function startScheduler(jobs: ScheduledJob[] = buildJobRegistry()): void {
  const state = getState()
  if (state.started) return
  if (process.env.SCHEDULER_ENABLED === "0") {
    console.log("[scheduler] disabled via SCHEDULER_ENABLED=0")
    return
  }
  state.started = true

  console.log(`[scheduler] starting ${jobs.length} background jobs`)

  for (const job of jobs) {
    state.statusByJob.set(job.name, initStatus(job))
    if (job.runOnStart) {
      void runOnce(job)
    }
    state.timers.push(setInterval(() => void runOnce(job), job.intervalMs))
  }
}

// Test/dev-only escape hatch — production has no reason to ever stop the
// scheduler mid-process.
export function stopScheduler(): void {
  const state = getState()
  for (const timer of state.timers) clearInterval(timer)
  state.timers.length = 0
  state.statusByJob.clear()
  state.started = false
}

export function getSchedulerStatus(): JobStatus[] {
  return Array.from(getState().statusByJob.values())
}

export function isSchedulerStarted(): boolean {
  return getState().started
}
