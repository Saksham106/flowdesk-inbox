import { prisma } from "@/lib/prisma"

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
  await prisma.aiUsageEvent
    ?.create({
      data: {
        tenantId: input.tenantId,
        feature: input.feature,
        model: input.model,
        estimatedInputTokens: input.estimatedInputTokens ?? 0,
        estimatedOutputTokens: input.estimatedOutputTokens ?? 0,
        status: input.status,
      },
    })
    .catch(() => {})
}
