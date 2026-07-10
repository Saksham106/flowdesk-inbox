import { prisma } from "@/lib/prisma"
import { estimateCostUsd } from "@/lib/ai/budget"

export function estimateTokenCount(value: string): number {
  return Math.ceil(value.length / 4)
}

export async function recordAiUsageEvent(input: {
  tenantId: string
  userId?: string | null
  feature: string
  model: string
  provider?: string
  providerKeyHash?: string | null
  providerGenerationId?: string | null
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  actualCostUsd?: number | null
  status: string
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const estimatedInputTokens = input.estimatedInputTokens ?? 0
  const estimatedOutputTokens = input.estimatedOutputTokens ?? 0
  const preCallEstimateUsd =
    input.status === "succeeded" ? estimateCostUsd(input.model, estimatedInputTokens, estimatedOutputTokens) : 0
  // budget.ts sums `estimatedCostUsd` to compute daily/monthly spend against the
  // tenant's limits, so once we know the actual provider-reported cost of a call,
  // that's the figure that should count toward budget — falling back to the
  // pre-call estimate when no actual cost is available (e.g. blocked/failed calls).
  const spendCostUsd = input.actualCostUsd ?? preCallEstimateUsd

  await prisma.aiUsageEvent
    ?.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? undefined,
        feature: input.feature,
        model: input.model,
        provider: input.provider ?? "openrouter",
        providerKeyHash: input.providerKeyHash ?? undefined,
        providerGenerationId: input.providerGenerationId ?? undefined,
        estimatedInputTokens,
        estimatedOutputTokens,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        totalTokens: input.totalTokens ?? 0,
        estimatedCostUsd: spendCostUsd,
        actualCostUsd: input.actualCostUsd ?? undefined,
        status: input.status,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
      },
    })
    .catch(() => {})
}
