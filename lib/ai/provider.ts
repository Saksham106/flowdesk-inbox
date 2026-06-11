import { generateDraftReplyWithOpenAI, generatePersonalStyleProfileWithOpenAI } from "@/lib/ai/openai"
import type { DraftReplyPromptInput, DraftReplyResult } from "@/lib/ai/prompts/draft-reply"
import type { PersonalStyleProfile } from "@/lib/ai/prompts/draft-reply"
import { explainThreadWithOpenAI, summarizeLearnedReplyProfileWithOpenAI } from "@/lib/ai/openai"
import type {
  LearnedReplyProfileResult,
  ReplyLearningSample,
} from "@/lib/ai/prompts/learned-reply-profile"
import type {
  ExplainThreadPromptInput,
  ExplainThreadResult,
} from "@/lib/ai/prompts/explain-thread"

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

export async function explainThread(
  input: ExplainThreadPromptInput
): Promise<ExplainThreadResult> {
  return explainThreadWithOpenAI(input)
}
