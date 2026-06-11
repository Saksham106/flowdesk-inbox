import OpenAI from "openai"

import {
  buildDraftReplyPrompt,
  draftReplyJsonSchema,
  normalizeDraftReplyOutput,
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

export async function explainThreadWithOpenAI(
  input: ExplainThreadPromptInput
): Promise<ExplainThreadResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildExplainThreadPrompt(input)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_explain_thread",
        strict: true,
        schema: explainThreadJsonSchema,
      },
    },
  })

  return normalizeExplainThreadOutput(response.output_text, model)
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

export async function generatePersonalStyleProfileWithOpenAI(
  messages: Array<{ body: string; createdAt: Date }>
): Promise<PersonalStyleProfile> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })

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

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_personal_style",
        strict: true,
        schema: personalStyleJsonSchema,
      },
    },
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(response.output_text)
  } catch {
    throw new Error("AI response was not valid JSON")
  }

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

export async function summarizeLearnedReplyProfileWithOpenAI(
  samples: ReplyLearningSample[]
): Promise<LearnedReplyProfileResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const model = process.env.OPENAI_LEARNING_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const client = new OpenAI({ apiKey })
  const prompt = buildLearnedReplyProfilePrompt(samples)

  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "flowdesk_learned_reply_profile",
        strict: true,
        schema: learnedReplyProfileJsonSchema,
      },
    },
  })

  return normalizeLearnedReplyProfileOutput(response.output_text, model, samples, prompt)
}
