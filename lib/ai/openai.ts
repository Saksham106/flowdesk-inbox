// Transport is OpenRouter (via lib/ai/gateway.ts's runAiJsonFeature), not the
// OpenAI SDK. The "*WithOpenAI" names are retained as compatibility names for
// existing callers/tests; see the note on each export below.
import { runAiJsonFeature } from "@/lib/ai/gateway"
import { estimateTokenCount } from "@/lib/ai/usage"

import {
  buildDraftReplyPrompt,
  draftReplyJsonSchema,
  normalizeDraftReplyOutput,
  type AiCallContext,
  type DraftReplyPromptInput,
  type DraftReplyResult,
  type PersonalStyleProfile,
} from "@/lib/ai/prompts/draft-reply"
import {
  buildLearnedReplyProfilePrompt,
  learnedReplyProfileJsonSchema,
  normalizeLearnedReplyProfileOutput,
  type LearnedReplyProfileResult,
  type ReplyLearningSample,
} from "@/lib/ai/prompts/learned-reply-profile"
import {
  buildExplainThreadPrompt,
  explainThreadJsonSchema,
  normalizeExplainThreadOutput,
  type ExplainThreadPromptInput,
  type ExplainThreadResult,
} from "@/lib/ai/prompts/explain-thread"
import {
  buildMeetingPrepPrompt,
  meetingPrepJsonSchema,
  normalizeMeetingPrepOutput,
  type MeetingPrepPromptInput,
  type MeetingPrepResult,
} from "@/lib/ai/prompts/meeting-prep"
import {
  buildMeetingFollowUpPrompt,
  meetingFollowUpJsonSchema,
  normalizeMeetingFollowUpOutput,
  type MeetingFollowUpPromptInput,
  type MeetingFollowUpResult,
} from "@/lib/ai/prompts/meeting-follow-up"
import {
  buildLeadScoringPrompt,
  leadScoringJsonSchema,
  normalizeLeadScoringOutput,
  type LeadScoringPromptInput,
  type LeadScoringResult,
} from "@/lib/ai/prompts/lead-scoring"

function requireAiContext(aiContext: AiCallContext | undefined, fnName: string): AiCallContext {
  if (!aiContext) {
    throw new Error(
      `AI provider is not configured: ${fnName} requires tenant/user context (aiContext) to route through OpenRouter`
    )
  }
  return aiContext
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function generateDraftReplyWithOpenAI(
  input: DraftReplyPromptInput
): Promise<DraftReplyResult> {
  const aiContext = requireAiContext(input.aiContext, "generateDraftReplyWithOpenAI")
  const prompt = buildDraftReplyPrompt(input)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: aiContext.tenantId,
    userId: aiContext.userId,
    userEmail: aiContext.userEmail,
    feature: "autopilot.draft",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_draft_reply",
    schema: draftReplyJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 500,
  })

  return normalizeDraftReplyOutput(JSON.stringify(output), model)
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function explainThreadWithOpenAI(
  input: ExplainThreadPromptInput
): Promise<ExplainThreadResult> {
  const aiContext = requireAiContext(input.aiContext, "explainThreadWithOpenAI")
  const prompt = buildExplainThreadPrompt(input)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: aiContext.tenantId,
    userId: aiContext.userId,
    userEmail: aiContext.userEmail,
    feature: "conversation.explain",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_explain_thread",
    schema: explainThreadJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 800,
  })

  return normalizeExplainThreadOutput(JSON.stringify(output), model)
}

const personalStyleJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "toneSummary",
    "greetingPatterns",
    "signoffPatterns",
    "sentenceLengthStyle",
    "formalityLevel",
    "recurringPhrasesToUse",
    "recurringPhrasesToAvoid",
    "sanitizedExamples",
  ],
  properties: {
    toneSummary: { anyOf: [{ type: "string" }, { type: "null" }] },
    greetingPatterns: { anyOf: [{ type: "string" }, { type: "null" }] },
    signoffPatterns: { anyOf: [{ type: "string" }, { type: "null" }] },
    sentenceLengthStyle: { anyOf: [{ type: "string" }, { type: "null" }] },
    formalityLevel: { anyOf: [{ type: "string" }, { type: "null" }] },
    recurringPhrasesToUse: { type: "array", items: { type: "string" } },
    recurringPhrasesToAvoid: { type: "array", items: { type: "string" } },
    sanitizedExamples: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function generatePersonalStyleProfileWithOpenAI(
  messages: Array<{ body: string; createdAt: Date }>,
  aiContext?: AiCallContext
): Promise<PersonalStyleProfile> {
  const context = requireAiContext(aiContext, "generatePersonalStyleProfileWithOpenAI")

  const messageBlock = messages
    .map((m, i) => `[${i + 1}] (${m.createdAt.toISOString()})\n${m.body}`)
    .join("\n\n---\n\n")

  const prompt = [
    "You are analyzing a user's personal email writing style to help an AI draft replies that match their voice.",
    "",
    "Analyze the following sent emails and extract a compact style profile. Return only JSON.",
    "",
    "Schema:",
    JSON.stringify(
      {
        toneSummary: "string — 1-2 sentence description of tone",
        greetingPatterns: "string — how they typically open emails",
        signoffPatterns: "string — how they typically close emails",
        sentenceLengthStyle: "string — short/medium/long sentences, mixed, etc.",
        formalityLevel: "string — casual/semi-formal/formal",
        recurringPhrasesToUse: ["array of phrases they often use"],
        recurringPhrasesToAvoid: [
          "array of patterns to avoid, e.g. corporate jargon they never use",
        ],
        sanitizedExamples:
          "string — 1-2 short example sentences that capture their style (sanitized of names/specifics)",
      },
      null,
      2
    ),
    "",
    "Sent emails (most recent first):",
    messageBlock,
  ].join("\n")

  const { output: parsed } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: context.tenantId,
    userId: context.userId,
    userEmail: context.userEmail,
    feature: "personal_profile.train",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_personal_style",
    schema: personalStyleJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 400,
  })

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }

  const p = parsed as Record<string, unknown>
  return {
    toneSummary: typeof p.toneSummary === "string" ? p.toneSummary : null,
    greetingPatterns: typeof p.greetingPatterns === "string" ? p.greetingPatterns : null,
    signoffPatterns: typeof p.signoffPatterns === "string" ? p.signoffPatterns : null,
    sentenceLengthStyle: typeof p.sentenceLengthStyle === "string" ? p.sentenceLengthStyle : null,
    formalityLevel: typeof p.formalityLevel === "string" ? p.formalityLevel : null,
    recurringPhrasesToUse: Array.isArray(p.recurringPhrasesToUse)
      ? (p.recurringPhrasesToUse as string[])
      : [],
    recurringPhrasesToAvoid: Array.isArray(p.recurringPhrasesToAvoid)
      ? (p.recurringPhrasesToAvoid as string[])
      : [],
    sanitizedExamples: typeof p.sanitizedExamples === "string" ? p.sanitizedExamples : null,
  }
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function summarizeLearnedReplyProfileWithOpenAI(
  samples: ReplyLearningSample[],
  aiContext?: AiCallContext
): Promise<LearnedReplyProfileResult> {
  const context = requireAiContext(aiContext, "summarizeLearnedReplyProfileWithOpenAI")
  const prompt = buildLearnedReplyProfilePrompt(samples)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: context.tenantId,
    userId: context.userId,
    userEmail: context.userEmail,
    feature: "reply_learning.summarize",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_learned_reply_profile",
    schema: learnedReplyProfileJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 800,
  })

  return normalizeLearnedReplyProfileOutput(JSON.stringify(output), model, samples, prompt)
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function generateMeetingPrepWithOpenAI(
  input: MeetingPrepPromptInput
): Promise<MeetingPrepResult> {
  const aiContext = requireAiContext(input.aiContext, "generateMeetingPrepWithOpenAI")
  const prompt = buildMeetingPrepPrompt(input)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: aiContext.tenantId,
    userId: aiContext.userId,
    userEmail: aiContext.userEmail,
    feature: "meeting.prep",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_meeting_prep",
    schema: meetingPrepJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 800,
  })

  return normalizeMeetingPrepOutput(JSON.stringify(output), model)
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function generateMeetingFollowUpWithOpenAI(
  input: MeetingFollowUpPromptInput
): Promise<MeetingFollowUpResult> {
  const aiContext = requireAiContext(input.aiContext, "generateMeetingFollowUpWithOpenAI")
  const prompt = buildMeetingFollowUpPrompt(input)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: aiContext.tenantId,
    userId: aiContext.userId,
    userEmail: aiContext.userEmail,
    feature: "meeting.follow_up",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_meeting_follow_up",
    schema: meetingFollowUpJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 600,
  })

  return normalizeMeetingFollowUpOutput(JSON.stringify(output), model)
}

// Compatibility name retained for existing tests/callers; transport is OpenRouter.
export async function scoreLeadWithOpenAI(
  input: LeadScoringPromptInput
): Promise<LeadScoringResult> {
  const aiContext = requireAiContext(input.aiContext, "scoreLeadWithOpenAI")
  const prompt = buildLeadScoringPrompt(input)

  const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: aiContext.tenantId,
    userId: aiContext.userId,
    userEmail: aiContext.userEmail,
    feature: "lead.score",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_lead_scoring",
    schema: leadScoringJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 500,
  })

  return normalizeLeadScoringOutput(JSON.stringify(output), model)
}
