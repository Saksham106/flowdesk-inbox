import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  isSchedulerStarted,
} from "@/lib/scheduler/run-scheduler"
import type { ScheduledJob } from "@/lib/scheduler/jobs"

describe("scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stopScheduler()
    delete process.env.SCHEDULER_ENABLED
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it("runs jobs marked runOnStart immediately", async () => {
    const run = vi.fn().mockResolvedValue("ok")
    startScheduler([{ name: "job-a", run, intervalMs: 60_000, runOnStart: true }])
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it("does not run jobs without runOnStart until the first interval elapses", async () => {
    const run = vi.fn().mockResolvedValue("ok")
    startScheduler([{ name: "job-a", run, intervalMs: 60_000 }])
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("is idempotent — calling startScheduler twice does not double-schedule", async () => {
    const run = vi.fn().mockResolvedValue("ok")
    const jobs: ScheduledJob[] = [{ name: "job-a", run, intervalMs: 60_000, runOnStart: true }]
    startScheduler(jobs)
    startScheduler(jobs)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(60_000)
    // Exactly one more call — a second internal setInterval would double this.
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("skips a tick if the previous run of the same job is still in flight", async () => {
    let resolveFirst: (() => void) | undefined
    const run = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveFirst = resolve })
    )
    startScheduler([{ name: "slow-job", run, intervalMs: 1_000, runOnStart: true }])

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    // Two intervals elapse while the first run is still pending.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(run).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("isolates a failing job — it does not stop other jobs or crash", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"))
    const healthy = vi.fn().mockResolvedValue("ok")
    startScheduler([
      { name: "failing-job", run: failing, intervalMs: 60_000, runOnStart: true },
      { name: "healthy-job", run: healthy, intervalMs: 60_000, runOnStart: true },
    ])

    await vi.waitFor(() => {
      expect(failing).toHaveBeenCalledTimes(1)
      expect(healthy).toHaveBeenCalledTimes(1)
    })

    const statuses = getSchedulerStatus()
    const failingStatus = statuses.find((s) => s.name === "failing-job")
    expect(failingStatus?.lastError).toBe("boom")
    expect(failingStatus?.errorCount).toBe(1)
    const healthyStatus = statuses.find((s) => s.name === "healthy-job")
    expect(healthyStatus?.lastError).toBeNull()
  })

  it("tracks per-job status: run count, last result, timestamps", async () => {
    const run = vi.fn().mockResolvedValue({ processed: 3 })
    startScheduler([{ name: "job-a", run, intervalMs: 60_000, runOnStart: true }])

    await vi.waitFor(() => {
      const status = getSchedulerStatus().find((s) => s.name === "job-a")
      expect(status?.runCount).toBe(1)
    })

    const status = getSchedulerStatus().find((s) => s.name === "job-a")
    expect(status?.lastResult).toEqual({ processed: 3 })
    expect(status?.lastStartedAt).not.toBeNull()
    expect(status?.lastFinishedAt).not.toBeNull()
    expect(status?.isRunning).toBe(false)
  })

  it("does not schedule anything when SCHEDULER_ENABLED=0", () => {
    process.env.SCHEDULER_ENABLED = "0"
    const run = vi.fn()
    startScheduler([{ name: "job-a", run, intervalMs: 60_000, runOnStart: true }])
    expect(isSchedulerStarted()).toBe(false)
    expect(getSchedulerStatus()).toEqual([])
  })
})
