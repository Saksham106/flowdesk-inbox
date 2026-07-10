// Pure aggregation over AiUsageEvent rows for the Settings → AI usage panel.
// Follows the command-center pattern: no prisma/IO here — the page fetches
// rows and passes them in, so the whole module is unit-testable as-is.

export type AiUsageEventRow = {
  feature: string
  estimatedCostUsd: number
  status: string
  createdAt: Date
  actualCostUsd?: number | null
  userId?: string | null
  provider?: string | null
}

export type AiFeatureUsage = {
  feature: string
  label: string
  dailyCostUsd: number
  monthlyCostUsd: number
  monthlyCalls: number
  monthlyBlocked: number
}

export type AiUsageSummary = {
  features: AiFeatureUsage[]
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dailyLimitUsd: number
  monthlyLimitUsd: number
  dailyRemainingUsd: number
  monthlyRemainingUsd: number
}

// Display names for the feature keys written by recordAiUsageEvent callers.
// person_memory.* sub-statuses are collapsed into one row via featureGroup.
const FEATURE_LABELS: Record<string, string> = {
  "chat.inbox": "Inbox chat",
  "agent_rule.compile": "Rule compilation",
  "agent.classify": "Email classification",
  "autopilot.draft": "Reply drafting",
  "lead.score": "Lead scoring",
  "reply_learning.summarize": "Reply-style learning",
  person_memory: "Person memory",
  "meeting.prep": "Meeting prep",
  "meeting.follow_up": "Meeting follow-up",
}

function featureGroup(feature: string): string {
  return feature.startsWith("person_memory.") ? "person_memory" : feature
}

export function describeAiFeature(feature: string): string {
  return FEATURE_LABELS[featureGroup(feature)] ?? feature
}

export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// Expects events from the current UTC month (the page queries with
// createdAt >= startOfMonthUtc); anything older is ignored defensively.
// Only "succeeded" events carry cost, matching checkAiBudget's accounting;
// "blocked" events are counted separately so the panel can show rejections.
export function summarizeAiUsage(
  events: AiUsageEventRow[],
  limits: { dailyLimitUsd: number; monthlyLimitUsd: number },
  now: Date = new Date()
): AiUsageSummary {
  const dayStart = startOfDayUtc(now)
  const monthStart = startOfMonthUtc(now)

  const byFeature = new Map<string, AiFeatureUsage>()

  for (const event of events) {
    if (event.createdAt < monthStart) continue

    const group = featureGroup(event.feature)
    let row = byFeature.get(group)
    if (!row) {
      row = {
        feature: group,
        label: describeAiFeature(group),
        dailyCostUsd: 0,
        monthlyCostUsd: 0,
        monthlyCalls: 0,
        monthlyBlocked: 0,
      }
      byFeature.set(group, row)
    }

    row.monthlyCalls += 1
    if (event.status === "blocked") {
      row.monthlyBlocked += 1
    } else if (event.status === "succeeded") {
      const cost = event.actualCostUsd ?? event.estimatedCostUsd
      row.monthlyCostUsd += cost
      if (event.createdAt >= dayStart) row.dailyCostUsd += cost
    }
  }

  const features = [...byFeature.values()].sort(
    (a, b) => b.monthlyCostUsd - a.monthlyCostUsd || a.label.localeCompare(b.label)
  )

  const dailyUsedUsd = features.reduce((sum, f) => sum + f.dailyCostUsd, 0)
  const monthlyUsedUsd = features.reduce((sum, f) => sum + f.monthlyCostUsd, 0)

  return {
    features,
    dailyUsedUsd,
    monthlyUsedUsd,
    dailyLimitUsd: limits.dailyLimitUsd,
    monthlyLimitUsd: limits.monthlyLimitUsd,
    dailyRemainingUsd: Math.max(limits.dailyLimitUsd - dailyUsedUsd, 0),
    monthlyRemainingUsd: Math.max(limits.monthlyLimitUsd - monthlyUsedUsd, 0),
  }
}
