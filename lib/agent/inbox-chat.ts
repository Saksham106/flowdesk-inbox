import OpenAI from "openai"
import { searchMessages } from "@/lib/agent/search"

const client = new OpenAI()

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export async function* streamInboxChat(
  tenantId: string,
  question: string,
  history: ChatMessage[] = []
): AsyncGenerator<string> {
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

  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: question },
    ],
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) yield text
  }
}
