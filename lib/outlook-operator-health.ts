import type { GmailOperatorHealthCheck, GmailOperatorHealthSummary } from "@/lib/gmail-operator-health"

export type OutlookOperatorHealthChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  subscriptionExpiresAt: Date | null
  subscriptionError: string | null
}

export type OutlookOperatorHealthInput = {
  now: Date
  channels: OutlookOperatorHealthChannel[]
  writebackPending: number
  writebackFailed: number
  oldestPendingWritebackAt: Date | null
  syncEventsFailed: number
}

type OutlookOperatorHealthCheck = GmailOperatorHealthCheck & {
  id: "outlook-auth-sync" | "outlook-subscription" | "outlook-writeback"
}

// Thresholds mirror lib/gmail-operator-health.ts (STALE_SYNC_MS/STALE_QUEUE_MS/
// WATCH_WARNING_MS) — copied rather than imported to keep the two provider
// modules independent; keep them in sync if the Gmail thresholds change.
const STALE_SYNC_MS = 60 * 60 * 1000
const STALE_QUEUE_MS = 30 * 60 * 1000
const SUBSCRIPTION_WARNING_MS = 24 * 60 * 60 * 1000

const AUTH_ERROR_PATTERN = /invalid_grant|401|AADSTS/i

function ageMinutes(now: Date, value: Date | null): number | null {
  if (!value) return null
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000))
}

function hasStaleOldest(now: Date, value: Date | null): boolean {
  return Boolean(value && now.getTime() - value.getTime() >= STALE_QUEUE_MS)
}

function worstStatus(checks: OutlookOperatorHealthCheck[]): GmailOperatorHealthSummary["status"] {
  if (checks.some((check) => check.status === "critical")) return "critical"
  if (checks.some((check) => check.status === "warning")) return "warning"
  return "healthy"
}

export function summarizeOutlookOperatorHealth(
  input: OutlookOperatorHealthInput
): GmailOperatorHealthSummary {
  const { now, channels } = input
  const connected = channels.length

  const authError = channels.find(
    (channel) => channel.lastSyncError && AUTH_ERROR_PATTERN.test(channel.lastSyncError)
  )
  const syncError = channels.find(
    (channel) => channel.lastSyncStatus === "error" || channel.lastSyncError
  )
  const lastSyncDates = channels
    .map((channel) => channel.lastSyncedAt)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())
  const latestSync = lastSyncDates[0] ?? null
  const latestSyncAge = latestSync ? now.getTime() - latestSync.getTime() : null

  const authSyncCheck: OutlookOperatorHealthCheck =
    connected === 0
      ? {
          id: "outlook-auth-sync",
          label: "Outlook connection",
          status: "warning",
          detail: "No Outlook account is connected yet.",
          action: "Connect Outlook before expecting labels or drafts.",
        }
      : authError
        ? {
            id: "outlook-auth-sync",
            label: "Outlook connection",
            status: "critical",
            detail: authError.lastSyncError ?? "Outlook authorization expired.",
            action: "Reconnect Outlook in Connected Accounts.",
          }
        : syncError
          ? {
              id: "outlook-auth-sync",
              label: "Outlook sync",
              status: "critical",
              detail: syncError.lastSyncError ?? "The last Outlook sync failed.",
              action: "Run manual sync after checking credentials.",
            }
          : !latestSync
            ? {
                id: "outlook-auth-sync",
                label: "Outlook sync",
                status: "warning",
                detail: "Outlook is connected but has not synced yet.",
                action: "Run manual sync to import recent inbox threads.",
              }
            : latestSyncAge !== null && latestSyncAge > STALE_SYNC_MS
              ? {
                  id: "outlook-auth-sync",
                  label: "Outlook sync",
                  status: "warning",
                  detail: `Last sync was ${ageMinutes(now, latestSync)} minutes ago.`,
                  action: "Check cron or run manual sync.",
                }
              : {
                  id: "outlook-auth-sync",
                  label: "Outlook sync",
                  status: "healthy",
                  detail: `Last sync was ${ageMinutes(now, latestSync)} minutes ago.`,
                  action: "No action needed.",
                }

  const subscriptionError = channels.find((channel) => channel.subscriptionError)
  const healthySubscription = channels.some((channel) => {
    const expiresAt = channel.subscriptionExpiresAt
    return Boolean(expiresAt && expiresAt.getTime() > now.getTime() + SUBSCRIPTION_WARNING_MS)
  })
  const subscriptionCheck: OutlookOperatorHealthCheck = subscriptionError
    ? {
        id: "outlook-subscription",
        label: "Outlook subscription",
        status: "critical",
        detail: subscriptionError.subscriptionError ?? "Outlook subscription renewal failed.",
        action: "Check outlook-subscription-renew cron and Microsoft Graph subscription setup.",
      }
    : input.syncEventsFailed > 0
      ? {
          id: "outlook-subscription",
          label: "Outlook subscription",
          status: "warning",
          detail: `${input.syncEventsFailed} sync notification failure${input.syncEventsFailed === 1 ? "" : "s"} in the last 24 hours.`,
          action: "Check outlook-sync-events processing and subscription status.",
        }
      : healthySubscription
        ? {
            id: "outlook-subscription",
            label: "Outlook subscription",
            status: "healthy",
            detail: "At least one Outlook subscription is active beyond the next 24 hours.",
            action: "No action needed.",
          }
        : {
            id: "outlook-subscription",
            label: "Outlook subscription",
            status: connected > 0 ? "warning" : "healthy",
            detail:
              connected > 0
                ? "No healthy Outlook subscription is visible."
                : "No Outlook account connected.",
            action:
              connected > 0
                ? "Check outlook-subscription-renew cron; polling is the fallback."
                : "Connect Outlook.",
          }

  const writebackCheck: OutlookOperatorHealthCheck =
    input.writebackFailed > 0
      ? {
          id: "outlook-writeback",
          label: "Outlook writeback",
          status: "critical",
          detail: `${input.writebackFailed} failed writeback job${input.writebackFailed === 1 ? "" : "s"}.`,
          action: "Open audit/writeback logs and fix the provider error.",
        }
      : input.writebackPending > 0
        ? {
            id: "outlook-writeback",
            label: "Outlook writeback",
            status: hasStaleOldest(now, input.oldestPendingWritebackAt) ? "warning" : "healthy",
            detail: `${input.writebackPending} pending writeback job${input.writebackPending === 1 ? "" : "s"}.`,
            action: hasStaleOldest(now, input.oldestPendingWritebackAt)
              ? "Check outlook-writeback cron."
              : "No action needed unless the queue keeps growing.",
          }
        : {
            id: "outlook-writeback",
            label: "Outlook writeback",
            status: "healthy",
            detail: "No pending or failed Outlook writebacks.",
            action: "No action needed.",
          }

  const checks = [authSyncCheck, subscriptionCheck, writebackCheck]
  const status = worstStatus(checks)
  const headline =
    status === "healthy"
      ? "Outlook operator loop is healthy"
      : status === "critical"
        ? "Outlook operator loop needs attention"
        : "Outlook operator loop has warnings"

  return { status, headline, checks }
}
