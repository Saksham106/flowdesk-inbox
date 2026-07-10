// Transport is OpenRouter, not the OpenAI SDK. This call site streams
// free-text chat tokens to the client (SSE), which does not fit
// runAiJsonFeature's single-shot structured-JSON contract (see lib/ai/gateway.ts).
// Rather than force a streaming call through a JSON-only gateway, this talks
// to OpenRouter directly using the same per-user key provisioning
// (getOpenRouterApiKeyForUser) that the gateway uses internally, and keeps
// this file's own budget-check/usage-recording wrapper as before.
import { searchMessages } from "@/lib/agent/search"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { getOpenRouterApiKeyForUser } from "@/lib/ai/openrouter-keys"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export async function* streamInboxChat(
  tenantId: string,
  question: string,
  history: ChatMessage[] = [],
  aiContext?: { userId: string; userEmail: string }
): AsyncGenerator<string> {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL

  const results = await searchMessages(tenantId, question, 5)

  const context = results.length > 0
    ? results
        .map((r, i) => `[Message ${i + 1}] (${r.direction}, ${new Date(r.createdAt).toLocaleDateString()})\n${r.body.slice(0, 500)}`)
        .join("\n\n---\n\n")
    : "No relevant messages found in inbox."

  const systemPrompt = `You are a personal chief of staff for the user's email inbox. Answer questions about their emails concisely and helpfully. Use the retrieved messages below as context.

Retrieved messages from inbox:
${context}

If the retrieved messages don't contain the answer, say so clearly. Do not make up information.`

  const estimatedInputTokens = estimateTokenCount(
    [systemPrompt, ...history.map((m) => m.content), question].join("\n")
  )
  const budgetCheck = await checkAiBudgetForTokens({
    tenantId,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: 1024,
  })
  if (!budgetCheck.allowed) {
    await recordAiUsageEvent({
      tenantId,
      userId: aiContext?.userId,
      feature: "chat.inbox",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    yield `${budgetCheck.reason} Inbox chat will be available again after the budget resets.`
    return
  }

  if (!aiContext) {
    await recordAiUsageEvent({
      tenantId,
      feature: "chat.inbox",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    throw new Error(
      "AI provider is not configured: streamInboxChat requires tenant/user context (aiContext) to route through OpenRouter"
    )
  }

  const runtimeKey = await getOpenRouterApiKeyForUser({
    tenantId,
    userId: aiContext.userId,
    email: aiContext.userEmail,
  })

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtimeKey.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://flowdeskinbox.com",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE ?? "FlowDesk Inbox",
    },
    body: JSON.stringify({
      model,
      user: aiContext.userId,
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ],
    }),
  })

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}))
    const message =
      typeof errBody?.error?.message === "string"
        ? errBody.error.message
        : `OpenRouter request failed (${res.status})`
    await recordAiUsageEvent({
      tenantId,
      userId: aiContext.userId,
      feature: "chat.inbox",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    throw new Error(message)
  }

  let output = ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const data = trimmed.slice(5).trim()
        if (data === "[DONE]") continue
        try {
          const parsed = JSON.parse(data)
          const text = parsed?.choices?.[0]?.delta?.content
          if (typeof text === "string" && text) {
            output += text
            yield text
          }
        } catch {
          // Ignore malformed SSE chunks; OpenRouter occasionally sends
          // keep-alive comments that aren't JSON.
        }
      }
    }
  } catch (err) {
    await recordAiUsageEvent({
      tenantId,
      userId: aiContext.userId,
      feature: "chat.inbox",
      model,
      estimatedInputTokens,
      estimatedOutputTokens: estimateTokenCount(output),
      status: "failed",
    })
    throw err
  }

  await recordAiUsageEvent({
    tenantId,
    userId: aiContext.userId,
    feature: "chat.inbox",
    model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(output),
    status: "succeeded",
  })
}
