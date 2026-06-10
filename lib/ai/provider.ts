import { generateDraftReplyWithOpenAI, generatePersonalStyleProfileWithOpenAI } from "@/lib/ai/openai"
import type { DraftReplyPromptInput, DraftReplyResult } from "@/lib/ai/prompts/draft-reply"
import type { PersonalStyleProfile } from "@/lib/ai/prompts/draft-reply"
import { summarizeLearnedReplyProfileWithOpenAI } from "@/lib/ai/openai"
import type {
  LearnedReplyProfileResult,
  ReplyLearningSample,
} from "@/lib/ai/prompts/learned-reply-profile"

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

export async function summarizeLearnedReplyProfile(
  samples: ReplyLearningSample[]
): Promise<LearnedReplyProfileResult> {
  return summarizeLearnedReplyProfileWithOpenAI(samples)
}
