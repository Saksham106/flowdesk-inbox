export type GmailOperatorHealthStatus = "healthy" | "warning" | "critical"

export type GmailOperatorHealthCheck = {
  id: "gmail-auth-sync" | "gmail-push" | "gmail-writeback" | "agent-jobs"
  label: string
  status: GmailOperatorHealthStatus
  detail: string
  action: string
}

export type GmailOperatorHealthSummary = {
  status: GmailOperatorHealthStatus
  headline: string
  checks: GmailOperatorHealthCheck[]
}

type GmailHealthChannel = {
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  watchExpiresAt: Date | string | null
  watchRenewalError: string | null
}

type QueueHealth = {
  pending: number
  processing?: number
  running?: number
  failed: number
  oldestPendingAt: Date | string | null
}

type GmailOperatorHealthInput = {
  now?: Date
  channels: GmailHealthChannel[]
  writeback: QueueHealth
  agentJobs: QueueHealth
  recentPushFailures: number
}

const STALE_SYNC_MS = 60 * 60 * 1000
const STALE_QUEUE_MS = 30 * 60 * 1000
const WATCH_WARNING_MS = 24 * 60 * 60 * 1000

function asDate(value: Date | string | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function ageMinutes(now: Date, value: Date | string | null): number | null {
  const date = asDate(value)
  if (!date) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000))
}

function hasStaleOldest(now: Date, value: Date | string | null): boolean {
  const date = asDate(value)
  return Boolean(date && now.getTime() - date.getTime() >= STALE_QUEUE_MS)
}

function worstStatus(checks: GmailOperatorHealthCheck[]): GmailOperatorHealthStatus {
  if (checks.some((check) => check.status === "critical")) return "critical"
  if (checks.some((check) => check.status === "warning")) return "warning"
  return "healthy"
}

export function summarizeGmailOperatorHealth(
  input: GmailOperatorHealthInput
): GmailOperatorHealthSummary {
  const now = input.now ?? new Date()
  const connected = input.channels.length
  const needsReauth = input.channels.find((channel) => channel.lastSyncStatus === "needs_reauth")
  const syncError = input.channels.find(
    (channel) => channel.lastSyncStatus === "error" || channel.lastSyncError
  )
  const lastSyncDates = input.channels
    .map((channel) => asDate(channel.lastSyncedAt))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())
  const latestSync = lastSyncDates[0] ?? null
  const latestSyncAge = latestSync ? now.getTime() - latestSync.getTime() : null

  const syncCheck: GmailOperatorHealthCheck =
    connected === 0
      ? {
          id: "gmail-auth-sync",
          label: "Gmail connection",
          status: "warning",
          detail: "No Gmail account is connected yet.",
          action: "Connect Gmail before expecting labels or drafts.",
        }
      : needsReauth
        ? {
            id: "gmail-auth-sync",
            label: "Gmail connection",
            status: "critical",
            detail: `${needsReauth.emailAddress ?? "Gmail"} needs reconnection.`,
            action: "Reconnect Gmail in Connected Accounts.",
          }
        : syncError
          ? {
              id: "gmail-auth-sync",
              label: "Gmail sync",
              status: "critical",
              detail: syncError.lastSyncError ?? "The last Gmail sync failed.",
              action: "Run manual sync after checking credentials.",
            }
          : !latestSync
            ? {
                id: "gmail-auth-sync",
                label: "Gmail sync",
                status: "warning",
                detail: "Gmail is connected but has not synced yet.",
                action: "Run manual sync to import recent inbox threads.",
              }
            : latestSyncAge !== null && latestSyncAge > STALE_SYNC_MS
              ? {
                  id: "gmail-auth-sync",
                  label: "Gmail sync",
                  status: "warning",
                  detail: `Last sync was ${ageMinutes(now, latestSync)} minutes ago.`,
                  action: "Check cron or run manual sync.",
                }
              : {
                  id: "gmail-auth-sync",
                  label: "Gmail sync",
                  status: "healthy",
                  detail: `Last sync was ${ageMinutes(now, latestSync)} minutes ago.`,
                  action: "No action needed.",
                }

  const watchError = input.channels.find((channel) => channel.watchRenewalError)
  const healthyWatch = input.channels.some((channel) => {
    const expiresAt = asDate(channel.watchExpiresAt)
    return Boolean(expiresAt && expiresAt.getTime() > now.getTime() + WATCH_WARNING_MS)
  })
  const pushCheck: GmailOperatorHealthCheck = watchError
    ? {
        id: "gmail-push",
        label: "Gmail push watch",
        status: "critical",
        detail: watchError.watchRenewalError ?? "Gmail watch renewal failed.",
        action: "Check gmail-watch cron and Google Pub/Sub setup.",
      }
    : input.recentPushFailures > 0
      ? {
          id: "gmail-push",
          label: "Gmail push watch",
          status: "warning",
          detail: `${input.recentPushFailures} push notification failure${input.recentPushFailures === 1 ? "" : "s"} in the last 24 hours.`,
          action: "Check push retry cron and Gmail watch status.",
        }
      : healthyWatch
        ? {
            id: "gmail-push",
            label: "Gmail push watch",
            status: "healthy",
            detail: "At least one Gmail watch is active beyond the next 24 hours.",
            action: "No action needed.",
          }
        : {
            id: "gmail-push",
            label: "Gmail push watch",
            status: connected > 0 ? "warning" : "healthy",
            detail: connected > 0 ? "No healthy Gmail watch is visible." : "No Gmail account connected.",
            action: connected > 0 ? "Check gmail-watch cron; polling is the fallback." : "Connect Gmail.",
          }

  const writeback = input.writeback
  const processingWritebacks = writeback.processing ?? 0
  const writebackCheck: GmailOperatorHealthCheck =
    writeback.failed > 0
      ? {
          id: "gmail-writeback",
          label: "Gmail writeback",
          status: "critical",
          detail: `${writeback.failed} failed writeback job${writeback.failed === 1 ? "" : "s"}.`,
          action: "Open audit/writeback logs and fix the provider error.",
        }
      : writeback.pending > 0 || processingWritebacks > 0
        ? {
            id: "gmail-writeback",
            label: "Gmail writeback",
            status: hasStaleOldest(now, writeback.oldestPendingAt) ? "warning" : "healthy",
            detail: `${writeback.pending} pending, ${processingWritebacks} processing writeback job${writeback.pending + processingWritebacks === 1 ? "" : "s"}.`,
            action: hasStaleOldest(now, writeback.oldestPendingAt)
              ? "Check gmail-writeback cron."
              : "No action needed unless the queue keeps growing.",
          }
        : {
            id: "gmail-writeback",
            label: "Gmail writeback",
            status: "healthy",
            detail: "No pending or failed Gmail writebacks.",
            action: "No action needed.",
          }

  const agentJobs = input.agentJobs
  const runningAgentJobs = agentJobs.running ?? 0
  const agentJobCheck: GmailOperatorHealthCheck =
    agentJobs.failed > 0
      ? {
          id: "agent-jobs",
          label: "Agent jobs",
          status: "critical",
          detail: `${agentJobs.failed} failed agent job${agentJobs.failed === 1 ? "" : "s"}.`,
          action: "Check agent-jobs cron and job errors.",
        }
      : agentJobs.pending > 0 || runningAgentJobs > 0
        ? {
            id: "agent-jobs",
            label: "Agent jobs",
            status: hasStaleOldest(now, agentJobs.oldestPendingAt) ? "warning" : "healthy",
            detail: `${agentJobs.pending} pending, ${runningAgentJobs} running agent job${agentJobs.pending + runningAgentJobs === 1 ? "" : "s"}.`,
            action: hasStaleOldest(now, agentJobs.oldestPendingAt)
              ? "Check agent-jobs cron; classification may be stalled."
              : "No action needed unless the queue keeps growing.",
          }
        : {
            id: "agent-jobs",
            label: "Agent jobs",
            status: "healthy",
            detail: "No pending or failed agent jobs.",
            action: "No action needed.",
          }

  const checks = [syncCheck, pushCheck, writebackCheck, agentJobCheck]
  const status = worstStatus(checks)
  const headline =
    status === "healthy"
      ? "Gmail operator loop is healthy"
      : status === "critical"
        ? "Gmail operator loop needs attention"
        : "Gmail operator loop has warnings"

  return { status, headline, checks }
}
