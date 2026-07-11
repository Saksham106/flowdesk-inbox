import type { Prisma } from "@prisma/client"

import { summarizeLearnedReplyProfile } from "@/lib/ai/provider"
import { prisma } from "@/lib/prisma"
import { fetchGmailSentSamples } from "@/lib/google"

export type ReplyProfileTypeValue = "personal" | "business"

export type OutboundReplySample = {
  text: string
  createdAt: Date
  subject?: string
  headers?: Record<string, string>
  provenance?: {
    source: "gmail_sent" | "flowdesk_database"
    messageId?: string
    threadId?: string | null
  }
}

const QUOTED_THREAD_PATTERNS = [
  /^On .+ wrote:$/im,
  /^From:\s.+$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
]

const AUTOMATED_PATTERNS = [
  /automated (message|notification|reply)/i,
  /do not reply/i,
  /no-?reply/i,
  /unsubscribe/i,
  /out of (the )?office/i,
  /away from (the )?office/i,
]

const FORWARDED_SUBJECT = /^\s*(?:fw|fwd)\s*:/i
const FORWARDED_BLOCK = /^(?:-{2,}\s*)?(?:begin\s+)?forwarded message(?:\s*-{2,})?\s*$/im
const FORWARDED_HEADERS = /^From:\s.+\nTo:\s.+$/im

export function sanitizeOutboundReply(body: string): string | null {
  let cleaned = body.replace(/\r\n/g, "\n").trim()
  if (!cleaned) return null

  for (const pattern of QUOTED_THREAD_PATTERNS) {
    const match = cleaned.match(pattern)
    if (match?.index !== undefined && match.index >= 0) {
      cleaned = cleaned.slice(0, match.index).trim()
    }
  }

  cleaned = cleaned
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (cleaned.length < 12) return null
  if (AUTOMATED_PATTERNS.some((pattern) => pattern.test(cleaned))) return null

  return cleaned.length > 1600 ? `${cleaned.slice(0, 1600)}...` : cleaned
}

export async function collectOutboundReplySamples(input: {
  tenantId: string
  channelId?: string | null
  limit?: number
}): Promise<OutboundReplySample[]> {
  const messages = await prisma.message.findMany({
    where: {
      direction: "outbound",
      conversation: {
        tenantId: input.tenantId,
        ...(input.channelId ? { channelId: input.channelId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 120,
    select: { body: true, createdAt: true },
  })

  return messages
    .map((message) => {
      const text = sanitizeOutboundReply(message.body)
      return text ? { text, createdAt: message.createdAt } : null
    })
    .filter((sample): sample is OutboundReplySample => sample !== null)
}

/**
 * Keeps only authored outbound text suitable for style learning. The output is
 * intentionally limited to sanitized reply text and provenance so callers can
 * report why a candidate was rejected without retaining raw mail bodies.
 */
export function filterAuthenticOutboundSamples(samples: OutboundReplySample[]): {
  samples: OutboundReplySample[]
  excluded: Record<string, number>
} {
  const accepted: OutboundReplySample[] = []
  const excluded: Record<string, number> = {}
  const seen = new Set<string>()
  const exclude = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1
  }

  for (const sample of samples) {
    if (sample.provenance?.source === "flowdesk_database") {
      exclude("unverified_database")
      continue
    }
    if (FORWARDED_SUBJECT.test(sample.subject ?? "")) {
      exclude("forwarded_subject")
      continue
    }
    if (FORWARDED_BLOCK.test(sample.text)) {
      exclude("forwarded_block")
      continue
    }
    if (FORWARDED_HEADERS.test(sample.text)) {
      exclude("forwarded_headers")
      continue
    }
    if (hasAutomatedHeaders(sample.headers) || AUTOMATED_PATTERNS.some((pattern) => pattern.test(sample.text))) {
      exclude("automated")
      continue
    }

    const text = sanitizeOutboundReply(sample.text)
    if (!text) {
      exclude("unusable_text")
      continue
    }

    const normalized = normalizeForDuplicateDetection(text)
    if (seen.has(normalized)) {
      exclude("duplicate")
      continue
    }
    seen.add(normalized)
    accepted.push({ ...sample, text })
  }

  return { samples: accepted, excluded }
}

function hasAutomatedHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.toLowerCase()])
  )
  const autoSubmitted = normalized["auto-submitted"]
  return (
    (autoSubmitted !== undefined && autoSubmitted !== "no") ||
    normalized["x-autoreply"] !== undefined ||
    normalized["x-autorespond"] !== undefined ||
    normalized["list-id"] !== undefined
  )
}

function normalizeForDuplicateDetection(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export async function trainLearnedReplyProfile(input: {
  tenantId: string
  channelId?: string | null
  profileType: ReplyProfileTypeValue
  aiContext?: { userId: string; userEmail: string }
}): Promise<{ profileId: string; sampleCount: number; fromDb: number; fromGmail: number }> {
  const dbCandidates = (await collectOutboundReplySamples({
    tenantId: input.tenantId,
    channelId: input.channelId,
  })).map((sample) => ({
    ...sample,
    provenance: { source: "flowdesk_database" as const },
  }))

  let gmailCandidates: OutboundReplySample[] = []
  if (input.channelId) {
    gmailCandidates = (await fetchGmailSentSamples(input.channelId, 60)).map((sample) => ({
      ...sample,
      // Kept for compatibility with already-stored test fixtures while every
      // live Gmail fetch provides a concrete source message id.
      provenance: sample.provenance ?? { source: "gmail_sent" as const },
    }))
  }

  // Gmail Sent samples are the only trainable source: FlowDesk's persisted
  // outbound messages lack the subject and headers needed to reliably reject
  // forwards, list mail, and automated replies. Keep DB candidates here only
  // so source stats explain their exclusion.
  const filtered = filterAuthenticOutboundSamples([...dbCandidates, ...gmailCandidates])
  const samples = filtered.samples
  const fromDb = samples.filter((sample) => sample.provenance?.source === "flowdesk_database").length
  const fromGmail = samples.filter((sample) => sample.provenance?.source === "gmail_sent").length

  if (samples.length < 5) {
    const triedGmail = input.channelId
      ? " FlowDesk also checked your Gmail sent history."
      : ""
    throw new Error(
      `Not enough sent emails to learn from.${triedGmail} At least 5 usable sent emails are required.`
    )
  }

  // Budget checks and AiUsageEvent recording (success/blocked/failed) happen
  // inside runAiJsonFeature (via summarizeLearnedReplyProfile ->
  // summarizeLearnedReplyProfileWithOpenAI), keyed by the "reply_learning.summarize"
  // feature. That gateway call is the same underlying AI call this function
  // used to record separately as "reply_learning.train" — recording our own
  // AiUsageEvent on top would double-count spend for a single call. The
  // gateway throws on both a budget-block and a generation failure, so this
  // just lets that error propagate to the caller.
  const result = await summarizeLearnedReplyProfile(
    samples,
    input.aiContext
      ? { tenantId: input.tenantId, userId: input.aiContext.userId, userEmail: input.aiContext.userEmail }
      : undefined
  )

  const data = {
    tenantId: input.tenantId,
    channelId: input.channelId ?? null,
    profileType: input.profileType,
    styleSummaryJson: result.styleSummaryJson as Prisma.InputJsonValue,
    exampleSnippetsJson: result.exampleSnippetsJson as Prisma.InputJsonValue,
    sourceStatsJson: {
      ...result.sourceStatsJson,
      sampleCount: samples.length,
      fromDb,
      fromGmail,
      accepted: samples.length,
      excluded: filtered.excluded,
    } as Prisma.InputJsonValue,
    promptVersion: result.promptVersion,
    lastTrainedAt: new Date(),
  }

  const existing = await prisma.learnedReplyProfile.findFirst({
    where: {
      tenantId: input.tenantId,
      channelId: input.channelId ?? null,
      profileType: input.profileType,
    },
  })

  const profile = existing
    ? await prisma.learnedReplyProfile.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.learnedReplyProfile.create({ data })

  return {
    profileId: profile.id,
    sampleCount: samples.length,
    fromDb,
    fromGmail,
  }
}
