import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCheckAiBudgetForTokens = vi.fn()
const mockGetOpenRouterApiKeyForUser = vi.fn()
const mockCallOpenRouterJson = vi.fn()
const mockRecordAiUsageEvent = vi.fn()

vi.mock("@/lib/ai/budget", () => ({
  checkAiBudgetForTokens: mockCheckAiBudgetForTokens,
}))

vi.mock("@/lib/ai/openrouter-keys", () => ({
  getOpenRouterApiKeyForUser: mockGetOpenRouterApiKeyForUser,
}))

vi.mock("@/lib/ai/openrouter", () => ({
  callOpenRouterJson: mockCallOpenRouterJson,
}))

vi.mock("@/lib/ai/usage", () => ({
  recordAiUsageEvent: mockRecordAiUsageEvent,
}))

const baseInput = {
  tenantId: "t1",
  userId: "u1",
  userEmail: "a@example.com",
  feature: "test-feature",
  messages: [{ role: "user" as const, content: "hi" }],
  schemaName: "test_schema",
  schema: { type: "object" },
  estimatedInputTokens: 100,
  estimatedOutputTokens: 50,
}

describe("runAiJsonFeature", () => {
  let callOrder: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    callOrder = []
    mockCheckAiBudgetForTokens.mockImplementation(async () => {
      callOrder.push("budget")
      return { allowed: true, reason: "", estimatedCostUsd: 0.01 }
    })
    mockGetOpenRouterApiKeyForUser.mockImplementation(async () => {
      callOrder.push("getKey")
      return { apiKey: "sk-or-test", keyHash: "hash1" }
    })
    mockCallOpenRouterJson.mockImplementation(async () => {
      callOrder.push("call")
      return {
        output: { ok: true },
        model: "anthropic/claude-sonnet-4.5",
        providerGenerationId: "gen-1",
        providerKeyHash: "hash1",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        actualCostUsd: 0.002,
      }
    })
    mockRecordAiUsageEvent.mockResolvedValue(undefined)
  })

  it("blocks when budget check disallows: no key provisioning, no OpenRouter call, records blocked event, throws", async () => {
    mockCheckAiBudgetForTokens.mockImplementation(async () => {
      callOrder.push("budget")
      return { allowed: false, reason: "Daily budget exceeded", estimatedCostUsd: 0.01 }
    })

    const { runAiJsonFeature } = await import("@/lib/ai/gateway")
    await expect(runAiJsonFeature(baseInput)).rejects.toThrow("Daily budget exceeded")

    expect(mockGetOpenRouterApiKeyForUser).not.toHaveBeenCalled()
    expect(mockCallOpenRouterJson).not.toHaveBeenCalled()
    expect(mockRecordAiUsageEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        userId: "u1",
        feature: "test-feature",
        status: "blocked",
        errorCode: "budget_exceeded",
        errorMessage: "Daily budget exceeded",
      })
    )
    expect(callOrder).toEqual(["budget"])
  })

  it("records a failed event and throws when key provisioning fails", async () => {
    mockGetOpenRouterApiKeyForUser.mockImplementation(async () => {
      callOrder.push("getKey")
      throw new Error("provisioning blew up")
    })

    const { runAiJsonFeature } = await import("@/lib/ai/gateway")
    await expect(runAiJsonFeature(baseInput)).rejects.toThrow("provisioning blew up")

    expect(mockCallOpenRouterJson).not.toHaveBeenCalled()
    expect(mockRecordAiUsageEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "key_provisioning_failed",
        errorMessage: "provisioning blew up",
      })
    )
    expect(callOrder).toEqual(["budget", "getKey"])
  })

  it("resolves with output/model/providerGenerationId and records a success event on a successful call", async () => {
    const { runAiJsonFeature } = await import("@/lib/ai/gateway")
    const result = await runAiJsonFeature(baseInput)

    expect(result).toEqual({
      output: { ok: true },
      model: "anthropic/claude-sonnet-4.5",
      providerGenerationId: "gen-1",
    })

    expect(mockRecordAiUsageEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        model: "anthropic/claude-sonnet-4.5",
        providerGenerationId: "gen-1",
        actualCostUsd: 0.002,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    )
    expect(callOrder).toEqual(["budget", "getKey", "call"])
  })

  it("records a failed event and rethrows when the OpenRouter call throws after budget/key succeeded", async () => {
    const callError = new Error("upstream 500") as Error & { code?: string }
    callError.code = "upstream_error"
    mockCallOpenRouterJson.mockImplementation(async () => {
      callOrder.push("call")
      throw callError
    })

    const { runAiJsonFeature } = await import("@/lib/ai/gateway")
    await expect(runAiJsonFeature(baseInput)).rejects.toThrow("upstream 500")

    expect(mockRecordAiUsageEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "upstream_error",
        errorMessage: "upstream 500",
      })
    )
    expect(callOrder).toEqual(["budget", "getKey", "call"])
  })

  it("checks budget before provisioning a key or calling OpenRouter", async () => {
    const { runAiJsonFeature } = await import("@/lib/ai/gateway")
    await runAiJsonFeature(baseInput)

    const budgetOrder = mockCheckAiBudgetForTokens.mock.invocationCallOrder[0]
    const keyOrder = mockGetOpenRouterApiKeyForUser.mock.invocationCallOrder[0]
    const callOrderIdx = mockCallOpenRouterJson.mock.invocationCallOrder[0]

    expect(budgetOrder).toBeLessThan(keyOrder)
    expect(keyOrder).toBeLessThan(callOrderIdx)
  })

  it("resolves the model in priority order: explicit input.model, then OPENROUTER_MODEL, then the built-in fallback", async () => {
    const { runAiJsonFeature } = await import("@/lib/ai/gateway")

    await runAiJsonFeature({ ...baseInput, model: "explicit/model" })
    expect(mockCheckAiBudgetForTokens).toHaveBeenCalledWith(expect.objectContaining({ model: "explicit/model" }))

    vi.clearAllMocks()
    mockCheckAiBudgetForTokens.mockResolvedValue({ allowed: true, reason: "", estimatedCostUsd: 0.01 })
    mockGetOpenRouterApiKeyForUser.mockResolvedValue({ apiKey: "sk-or-test", keyHash: "hash1" })
    mockCallOpenRouterJson.mockResolvedValue({
      output: { ok: true },
      model: "anthropic/claude-sonnet-4.5",
      providerGenerationId: "gen-1",
      providerKeyHash: "hash1",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      actualCostUsd: 0.002,
    })

    vi.stubEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
    try {
      await runAiJsonFeature(baseInput)
      expect(mockCheckAiBudgetForTokens).toHaveBeenCalledWith(
        expect.objectContaining({ model: "deepseek/deepseek-v4-flash" })
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
