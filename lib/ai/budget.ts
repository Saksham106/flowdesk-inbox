import { prisma } from "@/lib/prisma"

const DEFAULT_DAILY_LIMIT_USD = 5.0
const DEFAULT_MONTHLY_LIMIT_USD = 50.0

// Conservative per-model pricing (USD per 1M tokens).
// Errs on the high side for unknown models.
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-5.4-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
}
const FALLBACK_PRICING = { inputPer1M: 1.0, outputPer1M: 3.0 }

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? FALLBACK_PRICING
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000
}

function startOfDayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function startOfMonthUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function getAiBudgetStatus(tenantId: string): Promise<{
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dailyLimitUsd: number
  monthlyLimitUsd: number
}> {
  const [budget, dailyAgg, monthlyAgg] = await Promise.all([
    prisma.aiBudget.findUnique({ where: { tenantId } }),
    prisma.aiUsageEvent.aggregate({
      where: { tenantId, createdAt: { gte: startOfDayUtc() }, status: "succeeded" },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.aiUsageEvent.aggregate({
      where: { tenantId, createdAt: { gte: startOfMonthUtc() }, status: "succeeded" },
      _sum: { estimatedCostUsd: true },
    }),
  ])

  return {
    dailyUsedUsd: dailyAgg._sum.estimatedCostUsd ?? 0,
    monthlyUsedUsd: monthlyAgg._sum.estimatedCostUsd ?? 0,
    dailyLimitUsd: budget?.dailyLimitUsd ?? DEFAULT_DAILY_LIMIT_USD,
    monthlyLimitUsd: budget?.monthlyLimitUsd ?? DEFAULT_MONTHLY_LIMIT_USD,
  }
}

export async function checkAiBudget(
  tenantId: string,
  estimatedCostUsd: number
): Promise<{ allowed: boolean; reason: string }> {
  const status = await getAiBudgetStatus(tenantId)

  if (status.dailyUsedUsd + estimatedCostUsd > status.dailyLimitUsd) {
    return {
      allowed: false,
      reason: `Daily AI spend limit reached ($${status.dailyLimitUsd.toFixed(2)}/day). Resets at midnight UTC.`,
    }
  }

  if (status.monthlyUsedUsd + estimatedCostUsd > status.monthlyLimitUsd) {
    return {
      allowed: false,
      reason: `Monthly AI spend limit reached ($${status.monthlyLimitUsd.toFixed(2)}/month). Resets at start of next month.`,
    }
  }

  return { allowed: true, reason: "Within budget" }
}

export async function checkAiBudgetForTokens(input: {
  tenantId: string
  model: string
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
}): Promise<{ allowed: boolean; reason: string; estimatedCostUsd: number }> {
  const estimatedCostUsd = estimateCostUsd(
    input.model,
    input.estimatedInputTokens ?? 0,
    input.estimatedOutputTokens ?? 0
  )
  const result = await checkAiBudget(input.tenantId, estimatedCostUsd)
  return { ...result, estimatedCostUsd }
}
