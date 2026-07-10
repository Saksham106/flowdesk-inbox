export type OpenRouterMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenRouterJsonCallInput = {
  apiKey: string
  keyHash: string | null
  userId: string
  model: string
  messages: OpenRouterMessage[]
  schemaName: string
  schema: Record<string, unknown>
  temperature?: number
  maxTokens?: number
}

export type OpenRouterCallResult<T> = {
  output: T
  model: string
  providerGenerationId: string | null
  providerKeyHash: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  actualCostUsd: number | null
}

/**
 * Low-level OpenRouter chat-completions client. Sends a single JSON-schema
 * constrained request and parses the structured JSON response. Does not know
 * about budgets, usage recording, or key provisioning — that's the gateway's job.
 */
export async function callOpenRouterJson<T>(input: OpenRouterJsonCallInput): Promise<OpenRouterCallResult<T>> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://flowdeskinbox.com",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "FlowDesk Inbox",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      user: input.userId,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `OpenRouter request failed (${res.status})`
    const err = new Error(message) as Error & { code?: string }
    err.code = String(data?.error?.code ?? res.status)
    throw err
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter response did not include content")

  let output: T
  try {
    output = JSON.parse(content) as T
  } catch {
    throw new Error("OpenRouter response was not valid JSON")
  }

  return {
    output,
    model: typeof data.model === "string" ? data.model : input.model,
    providerGenerationId: typeof data.id === "string" ? data.id : null,
    providerKeyHash: input.keyHash,
    inputTokens: Number(data.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data.usage?.completion_tokens ?? 0),
    totalTokens: Number(data.usage?.total_tokens ?? 0),
    actualCostUsd: typeof data.usage?.cost === "number" ? data.usage.cost : null,
  }
}
