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
  byEmailType: [string, number][]
  topDomains: [string, number][]
}

export type CleanupOverview = {
  groups: CleanupGroupView[]
  unsubscribeGroups: CleanupGroupView[]
  analytics: CleanupAnalytics
}

export function summarizeCleanupCandidates(candidates: CleanupCandidate[]): CleanupOverview {
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

  const byEmailType = new Map<string, number>()
  const byDomain = new Map<string, number>()

  for (const candidate of actionable) {
    const type = candidate.emailType ?? "unknown"
    byEmailType.set(type, (byEmailType.get(type) ?? 0) + 1)
  }
  for (const group of groups) {
    byDomain.set(group.domain, (byDomain.get(group.domain) ?? 0) + group.count)
  }

  return {
    groups,
    unsubscribeGroups: groups.filter((g) => g.hasUnsubscribe),
    analytics: {
      totalCandidates: candidates.length,
      totalCleanable: actionable.length,
      protectedOrSkipped: candidates.length - actionable.length,
      senderCount: groups.length,
      unsubscribableCount: groups.filter((g) => g.hasUnsubscribe).reduce((sum, g) => sum + g.count, 0),
      byEmailType: [...byEmailType.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      topDomains: [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    },
  }
}

export async function getCleanupOverview(tenantId: string): Promise<CleanupOverview> {
  // Cleanable candidates: newsletters/marketing plus quietly-handled and FYI
  // mail. The grouping helper applies the safety skip rules (never needs-reply,
  // waiting-on, important, or receipts), so this query stays permissive.
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
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
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
      stateRecord: {
        select: { emailType: true, attentionCategory: true, metadataJson: true },
      },
    },
    take: 400,
    orderBy: { lastMessageAt: "desc" },
  })

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

  return summarizeCleanupCandidates(candidates)
}
