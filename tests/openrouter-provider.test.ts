import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"

describe("callOpenRouterJson", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.OPENROUTER_HTTP_REFERER = "https://flowdeskinbox.com"
    process.env.OPENROUTER_APP_TITLE = "FlowDesk Inbox"
  })

  it("sends app headers, user id, model, schema, and returns usage metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "gen-1",
        model: "anthropic/claude-sonnet-4.5",
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
          cost: 0.0002,
        },
      }),
    }))

    const { callOpenRouterJson } = await import("@/lib/ai/openrouter")
    const result = await callOpenRouterJson<{ ok: boolean }>({
      apiKey: "sk-or-test",
      keyHash: "hash",
      userId: "u1",
      model: "anthropic/claude-sonnet-4.5",
      messages: [{ role: "user", content: "Return JSON" }],
      schemaName: "test_schema",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.providerGenerationId).toBe("gen-1")
    expect(result.actualCostUsd).toBe(0.0002)
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-test",
          "HTTP-Referer": "https://flowdeskinbox.com",
          "X-OpenRouter-Title": "FlowDesk Inbox",
        }),
      })
    )
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body)
    expect(body.user).toBe("u1")
    expect(body.response_format.type).toBe("json_schema")
  })
})
