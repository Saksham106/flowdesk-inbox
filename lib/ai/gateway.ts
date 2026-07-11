import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { getOpenRouterApiKeyForUser } from "@/lib/ai/openrouter-keys"
import { callOpenRouterJson, type OpenRouterMessage } from "@/lib/ai/openrouter"
import { recordAiUsageEvent } from "@/lib/ai/usage"

// Fallback used only when neither the caller nor OPENROUTER_MODEL specify a model.
const FALLBACK_MODEL = "deepseek/deepseek-v4-flash"

export type RunAiJsonFeatureInput = {
  tenantId: string
  userId: string
  userEmail: string
  feature: string
  model?: string
  messages: OpenRouterMessage[]
  schemaName: string
  schema: Record<string, unknown>
  temperature?: number
  maxTokens?: number
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
}

export type RunAiJsonFeatureResult<T> = {
  output: T
  model: string
  providerGenerationId: string | null
}

/**
 * Feature-level gateway that every AI JSON call site should go through
 * (wired up in Task 3). Responsibilities:
 *  1. Check tenant budget BEFORE provisioning a key or calling OpenRouter.
 *  2. Resolve a per-user OpenRouter runtime key (provisioning one if needed).
 *  3. Call OpenRouter and parse the structured JSON response.
 *  4. Record a success/blocked/failed AiUsageEvent, including provider
 *     metadata (model, providerGenerationId, actualCostUsd, tokens) on
 *     success, and status/errorCode/errorMessage on failure/blocked.
 *
 * Fails closed: if budget is blocked, or the call fails for any reason, this
 * throws (or the caller can catch and use per-feature deterministic
 * fallbacks) — it never silently swallows an error and returns a placeholder.
 */
export async function runAiJsonFeature<T>(input: RunAiJsonFeatureInput): Promise<RunAiJsonFeatureResult<T>> {
  const model = input.model ?? process.env.OPENROUTER_MODEL ?? FALLBACK_MODEL

  const recordEvent = (fields: Partial<Parameters<typeof recordAiUsageEvent>[0]>) =>
    recordAiUsageEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      feature: input.feature,
      model,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
      status: "failed",
      ...fields,
    })

  const budget = await checkAiBudgetForTokens({
    tenantId: input.tenantId,
    model,
    estimatedInputTokens: input.estimatedInputTokens,
    estimatedOutputTokens: input.estimatedOutputTokens,
  })

  if (!budget.allowed) {
    await recordEvent({
      status: "blocked",
      errorCode: "budget_exceeded",
      errorMessage: budget.reason,
    })
    throw new Error(budget.reason)
  }

  let runtimeKey: Awaited<ReturnType<typeof getOpenRouterApiKeyForUser>>
  try {
    runtimeKey = await getOpenRouterApiKeyForUser({
      tenantId: input.tenantId,
      userId: input.userId,
      email: input.userEmail,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to provision OpenRouter key"
    await recordEvent({
      status: "failed",
      errorCode: "key_provisioning_failed",
      errorMessage: message,
    })
    throw error
  }

  try {
    const result = await callOpenRouterJson<T>({
      apiKey: runtimeKey.apiKey,
      keyHash: runtimeKey.keyHash,
      userId: input.userId,
      model,
      messages: input.messages,
      schemaName: input.schemaName,
      schema: input.schema,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    })

    await recordEvent({
      model: result.model,
      provider: "openrouter",
      providerKeyHash: result.providerKeyHash,
      providerGenerationId: result.providerGenerationId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      actualCostUsd: result.actualCostUsd,
      status: "succeeded",
    })

    return {
      output: result.output,
      model: result.model,
      providerGenerationId: result.providerGenerationId,
    }
  } catch (error) {
    const err = error as Error & { code?: string }
    await recordEvent({
      provider: "openrouter",
      providerKeyHash: runtimeKey.keyHash,
      status: "failed",
      errorCode: err.code ?? "openrouter_call_failed",
      errorMessage: err.message ?? "OpenRouter call failed",
    })
    throw error
  }
}
