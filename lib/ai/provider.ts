import { generateDraftReplyWithOpenAI, generatePersonalStyleProfileWithOpenAI } from "@/lib/ai/openai"
import type { DraftReplyPromptInput, DraftReplyResult } from "@/lib/ai/prompts/draft-reply"
import type { PersonalStyleProfile } from "@/lib/ai/prompts/draft-reply"

export type GenerateDraftReplyInput = DraftReplyPromptInput

export async function generateDraftReply(
  input: GenerateDraftReplyInput
): Promise<DraftReplyResult> {
  return generateDraftReplyWithOpenAI(input)
}

export async function generatePersonalStyleProfile(
  messages: Array<{ body: string; createdAt: Date }>
): Promise<PersonalStyleProfile> {
  return generatePersonalStyleProfileWithOpenAI(messages)
}
