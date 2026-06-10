import type { Prisma } from "@prisma/client"

import { recordAiUsageEvent } from "@/lib/ai/usage"
import { summarizeLearnedReplyProfile } from "@/lib/ai/provider"
import { prisma } from "@/lib/prisma"

export type ReplyProfileTypeValue = "personal" | "business"

export type OutboundReplySample = {
  text: string
  createdAt: Date
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
]

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

export async function trainLearnedReplyProfile(input: {
  tenantId: string
  channelId?: string | null
  profileType: ReplyProfileTypeValue
}): Promise<{ profileId: string; sampleCount: number }> {
  const samples = await collectOutboundReplySamples({
    tenantId: input.tenantId,
    channelId: input.channelId,
  })

  if (samples.length < 5) {
    throw new Error("Not enough sent messages to learn from. Send at least 5 emails first.")
  }

  let result: Awaited<ReturnType<typeof summarizeLearnedReplyProfile>>
  try {
    result = await summarizeLearnedReplyProfile(samples)
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      feature: "reply_learning.train",
      model: result.model,
      estimatedInputTokens: result.estimatedInputTokens,
      estimatedOutputTokens: result.estimatedOutputTokens,
      status: "completed",
    })
  } catch (err) {
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      feature: "reply_learning.train",
      model: process.env.OPENAI_LEARNING_MODEL || process.env.OPENAI_MODEL || "unknown",
      status: "failed",
    })
    throw err
  }

  const data = {
    tenantId: input.tenantId,
    channelId: input.channelId ?? null,
    profileType: input.profileType,
    styleSummaryJson: result.styleSummaryJson as Prisma.InputJsonValue,
    exampleSnippetsJson: result.exampleSnippetsJson as Prisma.InputJsonValue,
    sourceStatsJson: {
      ...result.sourceStatsJson,
      sampleCount: samples.length,
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

  return { profileId: profile.id, sampleCount: samples.length }
}
