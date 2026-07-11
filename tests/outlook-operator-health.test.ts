import { describe, expect, it } from "vitest"

import { summarizeOutlookOperatorHealth } from "@/lib/outlook-operator-health"

const now = new Date("2026-07-07T16:00:00.000Z")

describe("summarizeOutlookOperatorHealth", () => {
  it("marks Outlook healthy when sync, subscription, and writeback queues are clear", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("healthy")
    expect(summary.headline).toContain("healthy")
    expect(summary.checks.map((check) => check.id)).toEqual([
      "outlook-auth-sync",
      "outlook-subscription",
      "outlook-writeback",
    ])
  })

  it("marks Outlook critical and asks to reconnect when lastSyncError signals an auth failure", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:00:00.000Z"),
          lastSyncStatus: "error",
          lastSyncError: "invalid_grant: token expired",
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("critical")
    const authCheck = summary.checks.find((check) => check.id === "outlook-auth-sync")
    expect(authCheck?.status).toBe("critical")
    expect(authCheck?.action).toContain("Reconnect Outlook")
  })

  it("recognizes 401 and AADSTS errors as auth failures too", () => {
    for (const errorText of ["401 Unauthorized", "AADSTS700082: refresh token expired"]) {
      const summary = summarizeOutlookOperatorHealth({
        now,
        channels: [
          {
            id: "chan-1",
            emailAddress: "user@example.com",
            lastSyncedAt: new Date("2026-07-07T15:00:00.000Z"),
            lastSyncStatus: "error",
            lastSyncError: errorText,
            subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
            subscriptionError: null,
          },
        ],
        writebackPending: 0,
        writebackFailed: 0,
        oldestPendingWritebackAt: null,
        syncEventsFailed: 0,
      })

      expect(summary.checks.find((check) => check.id === "outlook-auth-sync")?.action).toContain(
        "Reconnect Outlook"
      )
    }
  })

  it("marks Outlook critical when writebacks have failed", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 3,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("critical")
    expect(summary.checks.find((check) => check.id === "outlook-writeback")?.status).toBe(
      "critical"
    )
  })

  it("warns when the subscription expires within 24 hours", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-08T00:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("warning")
    expect(summary.checks.find((check) => check.id === "outlook-subscription")?.status).toBe(
      "warning"
    )
  })

  it("warns when sync is stale beyond an hour", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T14:30:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("warning")
    expect(summary.checks.find((check) => check.id === "outlook-auth-sync")?.status).toBe(
      "warning"
    )
  })

  it("warns when recent sync notification failures are present", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 2,
    })

    expect(summary.status).toBe("warning")
    expect(summary.checks.find((check) => check.id === "outlook-subscription")?.detail).toContain(
      "2 sync notification failure"
    )
  })

  it("warns when queued writebacks have been waiting too long", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [
        {
          id: "chan-1",
          emailAddress: "user@example.com",
          lastSyncedAt: new Date("2026-07-07T15:55:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          subscriptionExpiresAt: new Date("2026-07-10T16:00:00.000Z"),
          subscriptionError: null,
        },
      ],
      writebackPending: 4,
      writebackFailed: 0,
      oldestPendingWritebackAt: new Date("2026-07-07T15:20:00.000Z"),
      syncEventsFailed: 0,
    })

    expect(summary.status).toBe("warning")
    const writebackCheck = summary.checks.find((check) => check.id === "outlook-writeback")
    expect(writebackCheck?.status).toBe("warning")
    expect(writebackCheck?.detail).toContain("4 pending")
  })

  it("marks Outlook as needing connection when no channels exist", () => {
    const summary = summarizeOutlookOperatorHealth({
      now,
      channels: [],
      writebackPending: 0,
      writebackFailed: 0,
      oldestPendingWritebackAt: null,
      syncEventsFailed: 0,
    })

    expect(summary.checks.find((check) => check.id === "outlook-auth-sync")?.status).toBe(
      "warning"
    )
  })
})
