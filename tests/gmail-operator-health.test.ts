import { describe, expect, it } from "vitest"

import { summarizeGmailOperatorHealth } from "@/lib/gmail-operator-health"

const now = new Date("2026-07-07T16:00:00.000Z")

describe("summarizeGmailOperatorHealth", () => {
  it("marks Gmail healthy when sync, watch, writeback, and agent queues are clear", () => {
    const summary = summarizeGmailOperatorHealth({
      now,
      channels: [
        {
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          watchExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          watchRenewalError: null,
        },
      ],
      writeback: { pending: 0, processing: 0, failed: 0, oldestPendingAt: null },
      agentJobs: { pending: 0, running: 0, failed: 0, oldestPendingAt: null },
      recentPushFailures: 0,
    })

    expect(summary.status).toBe("healthy")
    expect(summary.headline).toContain("Gmail operator loop is healthy")
  })

  it("marks Gmail critical when auth needs reconnection or writeback failed", () => {
    const summary = summarizeGmailOperatorHealth({
      now,
      channels: [
        {
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:00:00.000Z"),
          lastSyncStatus: "needs_reauth",
          lastSyncError: "Gmail authorization expired",
          watchExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          watchRenewalError: null,
        },
      ],
      writeback: {
        pending: 0,
        processing: 0,
        failed: 2,
        oldestPendingAt: null,
      },
      agentJobs: { pending: 0, running: 0, failed: 0, oldestPendingAt: null },
      recentPushFailures: 0,
    })

    expect(summary.status).toBe("critical")
    expect(summary.checks.map((check) => check.id)).toContain("gmail-auth-sync")
    expect(summary.checks.find((check) => check.id === "gmail-writeback")?.status).toBe(
      "critical"
    )
  })

  it("warns when queued writebacks or agent jobs are waiting too long", () => {
    const summary = summarizeGmailOperatorHealth({
      now,
      channels: [
        {
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          watchExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          watchRenewalError: null,
        },
      ],
      writeback: {
        pending: 4,
        processing: 1,
        failed: 0,
        oldestPendingAt: new Date("2026-07-07T15:20:00.000Z"),
      },
      agentJobs: {
        pending: 3,
        running: 0,
        failed: 0,
        oldestPendingAt: new Date("2026-07-07T14:55:00.000Z"),
      },
      recentPushFailures: 1,
    })

    expect(summary.status).toBe("warning")
    expect(summary.checks.find((check) => check.id === "gmail-writeback")?.detail).toContain(
      "4 pending"
    )
    expect(summary.checks.find((check) => check.id === "agent-jobs")?.status).toBe("warning")
    expect(summary.checks.find((check) => check.id === "gmail-push")?.status).toBe("warning")
  })
})
