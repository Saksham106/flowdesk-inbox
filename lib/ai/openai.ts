import OpenAI from "openai"

import {
  buildDraftReplyPrompt,
  draftReplyJsonSchema,
  normalizeDraftReplyOutput,
  type DraftReplyPromptInput,
  type DraftReplyResult,
} from "@/lib/ai/prompts/draft-reply"

export async function generateDraftReplyWithOpenAI(
  input: DraftReplyPromptInput
): Promise<DraftReplyResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildDraftReplyPrompt(input)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_draft_reply",
        strict: true,
        schema: draftReplyJsonSchema,
      },
    },
  })

  return normalizeDraftReplyOutput(response.output_text, model)
}
