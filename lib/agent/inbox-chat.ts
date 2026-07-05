import OpenAI from "openai"
import { searchMessages } from "@/lib/agent/search"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export async function* streamInboxChat(
  tenantId: string,
  question: string,
  history: ChatMessage[] = []
): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"

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
      feature: "chat.inbox",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    yield `${budgetCheck.reason} Inbox chat will be available again after the budget resets.`
    return
  }

  const client = new OpenAI({ apiKey })
  const stream = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: question },
    ],
  })

  let output = ""
  try {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) {
        output += text
        yield text
      }
    }
  } catch (err) {
    await recordAiUsageEvent({
      tenantId,
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
    feature: "chat.inbox",
    model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(output),
    status: "succeeded",
  })
}
