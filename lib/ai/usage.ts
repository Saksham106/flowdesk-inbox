import { prisma } from "@/lib/prisma"
import { estimateCostUsd } from "@/lib/ai/budget"

export function estimateTokenCount(value: string): number {
  return Math.ceil(value.length / 4)
}

export async function recordAiUsageEvent(input: {
  tenantId: string
  feature: string
  model: string
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  status: string
}): Promise<void> {
  const inputTokens = input.estimatedInputTokens ?? 0
  const outputTokens = input.estimatedOutputTokens ?? 0
  const cost = input.status === "succeeded" ? estimateCostUsd(input.model, inputTokens, outputTokens) : 0

  await prisma.aiUsageEvent
    ?.create({
      data: {
        tenantId: input.tenantId,
        feature: input.feature,
        model: input.model,
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: cost,
        status: input.status,
      },
    })
    .catch(() => {})
}
