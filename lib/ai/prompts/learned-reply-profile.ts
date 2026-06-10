import { estimateTokenCount } from "@/lib/ai/usage"

export const REPLY_LEARNING_PROMPT_VERSION = "reply-learning-v1"

export type ReplyLearningSample = {
  text: string
  createdAt: Date
}

export type LearnedReplyProfileResult = {
  styleSummaryJson: Record<string, unknown>
  exampleSnippetsJson: string[]
  sourceStatsJson: Record<string, unknown>
  promptVersion: string
  model: string
  estimatedInputTokens: number
  estimatedOutputTokens: number
}

export const learnedReplyProfileJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "styleSummary",
    "exampleSnippets",
    "thingsToAvoid",
    "commonPhrases",
    "formattingHabits",
  ],
  properties: {
    styleSummary: {
      type: "object",
      additionalProperties: false,
      required: ["tone", "formality", "length", "greetings", "signoffs"],
      properties: {
        tone: { type: "string" },
        formality: { type: "string" },
        length: { type: "string" },
        greetings: { type: "string" },
        signoffs: { type: "string" },
      },
    },
    exampleSnippets: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    thingsToAvoid: {
      type: "array",
      items: { type: "string" },
    },
    commonPhrases: {
      type: "array",
      items: { type: "string" },
    },
    formattingHabits: { type: "string" },
  },
}

export function buildLearnedReplyProfilePrompt(samples: ReplyLearningSample[]): string {
  const sampleBlock = samples
    .slice(0, 80)
    .map((sample, index) => {
      return `[${index + 1}] ${sample.createdAt.toISOString()}\n${truncate(sample.text, 1200)}`
    })
    .join("\n\n---\n\n")

  return [
    "You are analyzing outbound email replies to create a compact private writing-style profile.",
    "Do not preserve full emails. Do not include names, addresses, phone numbers, exact dates, prices, or private facts in examples.",
    "Return only JSON matching the schema.",
    "",
    "Summarize style, not factual business or personal commitments.",
    "Prefer short sanitized snippets that demonstrate voice without preserving sensitive content.",
    "",
    "Outbound reply samples:",
    sampleBlock || "No samples.",
  ].join("\n")
}

export function normalizeLearnedReplyProfileOutput(
  rawText: string,
  model: string,
  samples: ReplyLearningSample[],
  inputPrompt: string
): LearnedReplyProfileResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("Learning response was not valid JSON")
  }

  if (!isRecord(parsed)) {
    throw new Error("Learning response was not an object")
  }

  const styleSummary = isRecord(parsed.styleSummary) ? parsed.styleSummary : {}
  const exampleSnippets = asStringArray(parsed.exampleSnippets).map((snippet) =>
    truncate(snippet, 240)
  )

  return {
    styleSummaryJson: {
      ...styleSummary,
      thingsToAvoid: asStringArray(parsed.thingsToAvoid),
      commonPhrases: asStringArray(parsed.commonPhrases),
      formattingHabits: typeof parsed.formattingHabits === "string" ? parsed.formattingHabits : "",
    },
    exampleSnippetsJson: exampleSnippets,
    sourceStatsJson: {
      sampleCount: samples.length,
      newestSampleAt: samples[0]?.createdAt.toISOString() ?? null,
      oldestSampleAt: samples[samples.length - 1]?.createdAt.toISOString() ?? null,
    },
    promptVersion: REPLY_LEARNING_PROMPT_VERSION,
    model,
    estimatedInputTokens: estimateTokenCount(inputPrompt),
    estimatedOutputTokens: estimateTokenCount(rawText),
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 12)
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
