import { generateDraftReplyWithOpenAI } from "@/lib/ai/openai"
import type { DraftReplyPromptInput, DraftReplyResult } from "@/lib/ai/prompts/draft-reply"

export type GenerateDraftReplyInput = DraftReplyPromptInput

export async function generateDraftReply(
  input: GenerateDraftReplyInput
): Promise<DraftReplyResult> {
  return generateDraftReplyWithOpenAI(input)
}
