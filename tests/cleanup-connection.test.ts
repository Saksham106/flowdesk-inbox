import { describe, expect, it } from "vitest"
import { cleanupConnectionIssue, type EmailChannelHealth } from "@/lib/cleanup-candidates"

function channel(overrides: Partial<EmailChannelHealth> = {}): EmailChannelHealth {
  return {
    provider: overrides.provider ?? "google",
    lastSyncedAt: "lastSyncedAt" in overrides ? overrides.lastSyncedAt! : new Date("2026-07-10T12:00:00.000Z"),
    lastSyncError: overrides.lastSyncError ?? null,
  }
}

describe("cleanupConnectionIssue", () => {
  it("reports not_connected when the tenant has no email channels", () => {
    expect(cleanupConnectionIssue([])).toBe("not_connected")
  })

  it("returns null when at least one channel has synced without errors", () => {
    expect(cleanupConnectionIssue([channel()])).toBeNull()
  })

  it("a healthy channel outweighs a broken one", () => {
    expect(
      cleanupConnectionIssue([
        channel({ lastSyncError: "invalid_grant", lastSyncedAt: null }),
        channel({ provider: "outlook" }),
      ])
    ).toBeNull()
  })

  it("reports auth_error for invalid_grant so the UI can offer a reconnect", () => {
    expect(cleanupConnectionIssue([channel({ lastSyncError: "invalid_grant" })])).toBe("auth_error")
  })

  it("reports auth_error for expired or revoked tokens", () => {
    expect(cleanupConnectionIssue([channel({ lastSyncError: "Token has been expired or revoked." })])).toBe(
      "auth_error"
    )
  })

  it("reports sync_error for non-auth sync failures", () => {
    expect(cleanupConnectionIssue([channel({ lastSyncError: "quota exceeded" })])).toBe("sync_error")
  })

  it("reports never_synced when connected but no sync has completed", () => {
    expect(cleanupConnectionIssue([channel({ lastSyncedAt: null })])).toBe("never_synced")
  })
})
