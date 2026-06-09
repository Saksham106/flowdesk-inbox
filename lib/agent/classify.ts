import OpenAI from "openai"

import {
  buildClassifyPrompt,
  classifyJsonSchema,
  normalizeClassifyOutput,
  type ClassifyPromptInput,
  type ClassifyResult,
} from "@/lib/ai/prompts/classify"

export type { ClassifyPromptInput, ClassifyResult }

export async function classifyConversation(
  input: ClassifyPromptInput
): Promise<ClassifyResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildClassifyPrompt(input)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_classify",
        strict: true,
        schema: classifyJsonSchema,
      },
    },
  })

  return normalizeClassifyOutput(response.output_text)
}
