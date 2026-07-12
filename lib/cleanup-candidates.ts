/**
 * Shared candidate source for the three Clean Inbox pages (Bulk Archive,
 * Bulk Unsubscribe, Analytics). All three previously ran byte-for-byte
 * identical Prisma queries and candidate-mapping code; this module is the
 * single place that fetches + maps + summarizes, so the pages just pick
 * which slice of the summary they need.
 *
 * `summarizeCleanupCandidates` is pure (no Prisma) so it's unit-testable in
 * isolation. `getCleanupOverview` is the thin async wrapper that fetches
 * from the database and hands the result to the pure function.
 */

import { prisma } from "@/lib/prisma"
import { groupCleanupBySender, type CleanupCandidate } from "@/lib/agent/sender-cleanup"
import { cleanupRangeCutoff, previousCleanupRangeWindow, type CleanupRange } from "@/lib/cleanup-range"

export type CleanupGroupView = {
  senderEmail: string
  senderName: string
  domain: string
  count: number
  sampleSubjects: string[]
  conversationIds: string[]
  hasUnsubscribe: boolean
}

export type CleanupAnalytics = {
  totalCandidates: number
  totalCleanable: number
  protectedOrSkipped: number
  senderCount: number
  unsubscribableCount: number
  noUnsubscribeLinkCount: number
  byEmailType: [string, number][]
  topDomains: [string, number][]
}

export type CleanupSummary = {
  groups: CleanupGroupView[]
  labelGroups: CleanupLabelGroupView[]
  unsubscribeGroups: CleanupGroupView[]
  analytics: CleanupAnalytics
}

export type CleanupLabelGroupView = {
  label: string
  count: number
  sampleSenders: string[]
  conversationIds: string[]
}

export type CleanupConnectionIssue = "not_connected" | "auth_error" | "sync_error" | "never_synced"

export type CleanupOverview = CleanupSummary & {
  connectionIssue: CleanupConnectionIssue | null
}

export type CleanupTrendDirection = "up" | "down" | "flat"

export type CleanupTrend = {
  /**
   * "down" = fewer cleanable conversations than the prior period (the good
   * direction — render green). "up" = more than the prior period (render
   * red). "flat" = no meaningful change, or no prior-period data to compare
   * against (render neutral/gray).
   */
  direction: CleanupTrendDirection
  /** Percentage change vs. the prior period. `null` when it can't be meaningfully
   * expressed as a percentage (no prior period, or prior period was zero). */
  deltaPct: number | null
  deltaAbs: number
}

// Below this magnitude a percentage swing isn't worth calling out as a trend.
const FLAT_THRESHOLD_PCT = 1

/**
 * Pure, unit-testable period-over-period comparison for the analytics
 * headline stat. Deliberately takes `previous: CleanupAnalytics | null`
 * rather than assuming one always exists, since `range: "all"` has no
 * bounded prior period to compare against.
 */
export function computeCleanupTrend(
  current: CleanupAnalytics,
  previous: CleanupAnalytics | null
): CleanupTrend {
  const currentValue = current.totalCleanable
  if (!previous) {
    return { direction: "flat", deltaPct: null, deltaAbs: 0 }
  }

  const previousValue = previous.totalCleanable
  const deltaAbs = currentValue - previousValue

  if (previousValue === 0) {
    // Never divide by zero. If both periods are zero there's genuinely no
    // change; if the prior period had zero cleanable conversations but the
    // current one doesn't, there's a real increase but no sensible
    // percentage to attach to it (would be +Infinity), so report the
    // direction with a null percentage instead.
    if (currentValue === 0) return { direction: "flat", deltaPct: null, deltaAbs: 0 }
    return { direction: "up", deltaPct: null, deltaAbs }
  }

  const deltaPct = (deltaAbs / previousValue) * 100
  if (Math.abs(deltaPct) < FLAT_THRESHOLD_PCT) {
    return { direction: "flat", deltaPct, deltaAbs }
  }
  return { direction: deltaAbs > 0 ? "up" : "down", deltaPct, deltaAbs }
}

export type EmailChannelHealth = {
  provider: string
  lastSyncedAt: Date | null
  lastSyncError: string | null
}

const AUTH_ERROR_PATTERN = /invalid_grant|expired|revoked/i

/**
 * Why the cleanup pages may have nothing to show even though the user's real
 * inbox is full: no email channel, a dead OAuth grant, a failing sync, or a
 * connection that has never completed a sync. Distinguishing these from a
 * genuinely clean inbox lets the empty state say "reconnect Gmail" instead of
 * the misleading "your inbox looks clean".
 */
export function cleanupConnectionIssue(
  channels: EmailChannelHealth[]
): CleanupConnectionIssue | null {
  if (channels.length === 0) return "not_connected"
  if (channels.some((c) => c.lastSyncedAt && !c.lastSyncError)) return null
  const errors = channels.flatMap((c) => (c.lastSyncError ? [c.lastSyncError] : []))
  if (errors.some((e) => AUTH_ERROR_PATTERN.test(e))) return "auth_error"
  if (errors.length > 0) return "sync_error"
  return "never_synced"
}

export function summarizeCleanupCandidates(candidates: CleanupCandidate[]): CleanupSummary {
  const groups: CleanupGroupView[] = groupCleanupBySender(candidates).map((g) => ({
    senderEmail: g.senderEmail,
    senderName: g.senderName,
    domain: g.domain,
    count: g.count,
    sampleSubjects: g.sampleSubjects,
    conversationIds: g.conversationIds,
    hasUnsubscribe: g.hasUnsubscribe,
  }))

  // groupCleanupBySender silently drops "protected" conversations (needs-reply,
  // waiting-on, important, receipts, etc.), so headline counts must be derived
  // from the same actionable population the groups represent, not raw candidates.
  const actionableIds = new Set(groups.flatMap((g) => g.conversationIds))
  const actionable = candidates.filter((c) => actionableIds.has(c.id))
  const labelGroups = groupCleanupByLabel(actionable)

  const byEmailType = new Map<string, number>()
  const byDomain = new Map<string, number>()

  for (const candidate of actionable) {
    const type = candidate.emailType ?? "unknown"
    byEmailType.set(type, (byEmailType.get(type) ?? 0) + 1)
  }
  for (const group of groups) {
    byDomain.set(group.domain, (byDomain.get(group.domain) ?? 0) + group.count)
  }

  const unsubscribableCount = groups
    .filter((g) => g.hasUnsubscribe)
    .reduce((sum, g) => sum + g.count, 0)

  return {
    groups,
    labelGroups,
    unsubscribeGroups: groups.filter((g) => g.hasUnsubscribe),
    analytics: {
      totalCandidates: candidates.length,
      totalCleanable: actionable.length,
      protectedOrSkipped: candidates.length - actionable.length,
      senderCount: groups.length,
      unsubscribableCount,
      // Actionable conversations (i.e. present in `groups`) whose sender has no
      // detected unsubscribe link. Distinct from `protectedOrSkipped`, which is
      // about the full candidate population, not why `unsubscribeGroups`
      // specifically may be empty/smaller than `groups`.
      noUnsubscribeLinkCount: groups.reduce((sum, g) => sum + g.count, 0) - unsubscribableCount,
      byEmailType: [...byEmailType.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      topDomains: [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    },
  }
}

function groupCleanupByLabel(candidates: CleanupCandidate[]): CleanupLabelGroupView[] {
  const groups = new Map<string, { conversationIds: string[]; senders: string[] }>()
  for (const candidate of candidates) {
    const label = cleanupLabel(candidate.emailType)
    const group = groups.get(label) ?? { conversationIds: [], senders: [] }
    group.conversationIds.push(candidate.id)
    const sender = candidate.senderName?.trim() || candidate.senderEmail?.trim()
    if (sender && !group.senders.includes(sender) && group.senders.length < 3) group.senders.push(sender)
    groups.set(label, group)
  }
  return [...groups.entries()]
    .map(([label, group]) => ({
      label,
      count: group.conversationIds.length,
      sampleSenders: group.senders,
      conversationIds: group.conversationIds,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function cleanupLabel(emailType: string | null): string {
  if (emailType === "newsletter") return "Newsletter"
  if (emailType === "marketing") return "Marketing"
  if (emailType === "notification" || emailType === "fyi") return "Notification"
  if (emailType === "calendar") return "Calendar"
  return "Other"
}

export type CleanupSourceHealth = {
  provider: string | null
  gmailRawState: unknown
  stateMetadata: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Whether a classified-cleanable conversation still has anything to clean in
 * the user's real mailbox. Local `status` is NOT the signal: quiet/FYI mail is
 * auto-closed at sync time (work-item-sync) without ever being archived in
 * Gmail, so locally-closed conversations are usually still sitting in the
 * user's Gmail inbox. A conversation only stops being cleanable once it was
 * archived through Clean Inbox (`cleanInboxArchived`), archived individually
 * (`archivedAt`), or its Gmail thread has already left INBOX.
 */
export function stillNeedsCleanup(source: CleanupSourceHealth): boolean {
  const meta = asRecord(source.stateMetadata)
  if (meta?.cleanInboxArchived === true) return false
  if (typeof meta?.archivedAt === "string") return false
  if (source.provider === "google") {
    const labels = asRecord(source.gmailRawState)?.lastLabelIds
    // Pre-gmailRawState rows have no label snapshot; keep them (archiving an
    // already-archived thread is a harmless no-op).
    if (Array.isArray(labels)) return labels.includes("INBOX")
  }
  return true
}

export async function getCleanupOverview(tenantId: string, range: CleanupRange = "quarter"): Promise<CleanupOverview> {
  return getCleanupOverviewForWindow(tenantId, { start: cleanupRangeCutoff(range), end: null })
}

/**
 * Same data as `getCleanupOverview`, but for the date window immediately
 * preceding the current range's window (equal length) — used to compute the
 * headline trend badge without any new historical/snapshot storage. Returns
 * `null` for `range: "all"`, which has no bounded prior period.
 */
export async function getPreviousCleanupOverview(
  tenantId: string,
  range: CleanupRange
): Promise<CleanupOverview | null> {
  const window = previousCleanupRangeWindow(range)
  if (!window) return null
  return getCleanupOverviewForWindow(tenantId, window)
}

async function getCleanupOverviewForWindow(
  tenantId: string,
  window: { start: Date | null; end: Date | null }
): Promise<CleanupOverview> {
  const lastMessageAt: { gte?: Date; lt?: Date } = {}
  if (window.start) lastMessageAt.gte = window.start
  if (window.end) lastMessageAt.lt = window.end
  const hasBound = lastMessageAt.gte !== undefined || lastMessageAt.lt !== undefined

  const channels = await prisma.channel.findMany({
    where: { tenantId, type: "email" },
    select: {
      provider: true,
      gmailCredential: { select: { lastSyncedAt: true, lastSyncError: true } },
      outlookCredential: { select: { lastSyncedAt: true, lastSyncError: true } },
    },
  })
  const connectionIssue = cleanupConnectionIssue(
    channels.map((c) => ({
      provider: c.provider,
      lastSyncedAt: c.gmailCredential?.lastSyncedAt ?? c.outlookCredential?.lastSyncedAt ?? null,
      lastSyncError: c.gmailCredential?.lastSyncError ?? c.outlookCredential?.lastSyncError ?? null,
    }))
  )

  // Cleanable candidates: newsletters/marketing plus quietly-handled and FYI
  // mail. Deliberately includes locally-closed conversations — quiet/FYI mail
  // is auto-closed at sync time without ever leaving the user's Gmail inbox,
  // so `stillNeedsCleanup` (not local status) decides what is still cleanable.
  // The grouping helper applies the safety skip rules (never needs-reply,
  // waiting-on, important, or receipts), so this query stays permissive.
  const fetched = await prisma.conversation.findMany({
    where: {
      tenantId,
      ...(hasBound ? { lastMessageAt } : {}),
      OR: [
        { stateRecord: { emailType: { in: ["newsletter", "marketing"] } } },
        { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
      ],
    },
    select: {
      id: true,
      status: true,
      userState: true,
      lastMessageAt: true,
      gmailRawState: true,
      channel: { select: { provider: true } },
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
      stateRecord: {
        select: { emailType: true, attentionCategory: true, metadataJson: true },
      },
    },
    take: 400,
    orderBy: { lastMessageAt: "desc" },
  })

  const conversations = fetched.filter((c) =>
    stillNeedsCleanup({
      provider: c.channel?.provider ?? null,
      gmailRawState: c.gmailRawState,
      stateMetadata: c.stateRecord?.metadataJson,
    })
  )

  const candidates: CleanupCandidate[] = conversations.map((c) => {
    const meta =
      c.stateRecord?.metadataJson &&
      typeof c.stateRecord.metadataJson === "object" &&
      !Array.isArray(c.stateRecord.metadataJson)
        ? (c.stateRecord.metadataJson as Record<string, unknown>)
        : null
    return {
      id: c.id,
      senderEmail: c.contact?.phoneE164 ?? null,
      senderName: c.contact?.name ?? null,
      subject: c.messages[0]?.subject ?? null,
      emailType: c.stateRecord?.emailType ?? null,
      attentionCategory: c.stateRecord?.attentionCategory ?? null,
      status: c.status,
      userState: c.userState,
      hasUnsubscribe: typeof meta?.unsubscribeUrl === "string" && meta.unsubscribeUrl.length > 0,
      lastReceivedAt: c.lastMessageAt ?? new Date(0),
    }
  })

  return { ...summarizeCleanupCandidates(candidates), connectionIssue }
}
