import type { Prisma } from "@prisma/client"
import { createHash } from "crypto"
import OpenAI from "openai"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText } from "@/lib/email-body"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"

import {
  buildPersonMemoryExtractPrompt,
  normalizePersonMemoryExtractResult,
  personMemoryExtractJsonSchema,
} from "@/lib/ai/prompts/person-memory-extract"

const PROMISE_PATTERN = /\b(i['']ll|i will|we['']ll|we will|i['']m going to|i can)\b/i
const QUESTION_PATTERN = /\?$/m
const PREFERENCE_PATTERN = /\b(prefer|usually|always|never|like to|don['']t like|rather|favorite)\b/i

export type PersonMemoryDraft = {
  contactId: string
  tenantId: string
  lastContactAt: Date | null
  messageCount: number
  summary: string
  preferences: string | null
  openQuestions: string | null
  promisedActions: string | null
}

type ConversationRow = {
  id: string
  lastMessageAt: Date
  messages: Array<{ direction: string; body: string; createdAt: Date }>
}

export type PersonMemorySyncResult =
  | { status: "deterministic"; reason: string }
  | { status: "cache_hit"; contentHash: string }
  | { status: "llm_completed"; contentHash: string; model: string }
  | { status: "llm_failed"; reason: string }
  | { status: "skipped"; reason: string }

export type SyncPersonMemoryWithLLMOptions = {
  featureContext?: string
  force?: boolean
}

function getOpenAIClient(): OpenAI | null {
  return process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
}

export function buildPersonMemoryContentHash(
  messages: Array<{ direction: string; body: string; createdAt: Date }>
): string {
  const normalized = messages
    .map((message) => ({
      direction: message.direction,
      createdAt: message.createdAt.toISOString(),
      body: stripHtmlToText(message.body, 1200),
    }))
    .map((message) => `${message.createdAt}|${message.direction}|${message.body}`)
    .join("\n")

  return createHash("sha256").update(normalized).digest("hex")
}

export function buildPersonMemoryDraft(
  tenantId: string,
  contactId: string,
  contactName: string,
  conversations: ConversationRow[]
): PersonMemoryDraft {
  const allMessages = conversations
    .flatMap((c) => c.messages)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const inbound = allMessages.filter((m) => m.direction === "inbound")
  const outbound = allMessages.filter((m) => m.direction === "outbound")

  const lastContactAt =
    allMessages.length > 0
      ? allMessages[allMessages.length - 1].createdAt
      : null

  const promises = outbound
    .filter((m) => PROMISE_PATTERN.test(m.body))
    .slice(-3)
    .map((m) => `• ${m.body.slice(0, 120).trim()}`)

  const unansweredQuestions = inbound
    .filter((m) => QUESTION_PATTERN.test(m.body.trim()))
    .slice(-3)
    .map((m) => `• ${m.body.slice(0, 120).trim()}`)

  const preferenceMessages = inbound
    .filter((m) => PREFERENCE_PATTERN.test(m.body))
    .slice(-3)
    .map((m) => `• ${m.body.slice(0, 120).trim()}`)

  const convCount = conversations.length
  const summary =
    `${contactName} — ${allMessages.length} messages across ${convCount} conversation${convCount === 1 ? "" : "s"}. ` +
    (outbound.length > 0
      ? `You have replied ${outbound.length} time${outbound.length === 1 ? "" : "s"}.`
      : "You have not replied yet.")

  return {
    contactId,
    tenantId,
    lastContactAt,
    messageCount: allMessages.length,
    summary,
    preferences: preferenceMessages.length > 0 ? preferenceMessages.join("\n") : null,
    openQuestions: unansweredQuestions.length > 0 ? unansweredQuestions.join("\n") : null,
    promisedActions: promises.length > 0 ? promises.join("\n") : null,
  }
}

export async function syncPersonMemory(
  tenantId: string,
  contactId: string
): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: {
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 30 },
        },
      },
    },
  })

  if (!contact) return

  const draft = buildPersonMemoryDraft(
    tenantId,
    contactId,
    contact.name,
    contact.conversations
  )
  const allMessages = contact.conversations
    .flatMap((c) => c.messages)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  await prisma.personMemory.upsert({
    where: { contactId },
    create: {
      tenantId,
      contactId,
      lastContactAt: draft.lastContactAt,
      messageCount: draft.messageCount,
      summary: draft.summary,
      preferences: draft.preferences,
      openQuestions: draft.openQuestions,
      promisedActions: draft.promisedActions,
      source: "deterministic",
      contentHash: buildPersonMemoryContentHash(allMessages),
    },
    update: {
      lastContactAt: draft.lastContactAt,
      messageCount: draft.messageCount,
      summary: draft.summary,
      preferences: draft.preferences,
      openQuestions: draft.openQuestions,
      promisedActions: draft.promisedActions,
      source: "deterministic",
      contentHash: buildPersonMemoryContentHash(allMessages),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "person_memory.synced",
      payloadJson: {
        contactId,
        messageCount: draft.messageCount,
      } as Prisma.InputJsonValue,
    },
  })
}

export async function syncPersonMemoryWithLLM(
  tenantId: string,
  contactId: string,
  options: SyncPersonMemoryWithLLMOptions = {}
): Promise<PersonMemorySyncResult> {
  const client = getOpenAIClient()
  if (!client) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.deterministic_fallback",
      model: "none",
      status: "skipped",
    })
    return { status: "deterministic", reason: "OPENAI_API_KEY is not configured" }
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: {
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 30 },
        },
      },
    },
  })
  if (!contact) return { status: "skipped", reason: "Contact not found" }

  const allMessages = contact.conversations
    .flatMap((c) => c.messages)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: m.body,
      createdAt: m.createdAt,
    }))

  if (allMessages.length < 3) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.too_few_messages",
      model: "none",
      status: "skipped",
    })
    return { status: "deterministic", reason: "Too few messages for LLM relationship memory" }
  }

  const contentHash = buildPersonMemoryContentHash(allMessages)
  const existing = await prisma.personMemory.findUnique({
    where: { contactId },
    select: { contentHash: true, source: true },
  })

  if (!options.force && existing?.source === "llm" && existing.contentHash === contentHash) {
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.cache_hit",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      status: "skipped",
    })
    return { status: "cache_hit", contentHash }
  }

  const prompt = buildPersonMemoryExtractPrompt({
    contactName: contact.name,
    messages: allMessages,
  })

  let extracted: ReturnType<typeof normalizePersonMemoryExtractResult> = null
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const estimatedInputTokens = estimateTokenCount(prompt)
  const budgetCheck = await checkAiBudgetForTokens({
    tenantId,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: 500,
  })
  if (!budgetCheck.allowed) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: options.featureContext ? `person_memory.${options.featureContext}` : "person_memory.llm",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    return { status: "llm_failed", reason: budgetCheck.reason }
  }

  try {
    const response = await client.responses.create({
      model,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "flowdesk_person_memory_extract",
          strict: true,
          schema: personMemoryExtractJsonSchema,
        },
      },
    })
    const content = response.output_text
    if (content) {
      extracted = normalizePersonMemoryExtractResult(JSON.parse(content))
    }
  } catch (err) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.llm",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    return {
      status: "llm_failed",
      reason: err instanceof Error ? err.message : "Failed to generate person memory",
    }
  }

  if (!extracted) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.llm",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    return { status: "llm_failed", reason: "AI response did not include usable memory" }
  }

  await prisma.personMemory.upsert({
    where: { contactId },
    create: {
      tenantId,
      contactId,
      lastContactAt: allMessages[allMessages.length - 1]?.createdAt ?? null,
      messageCount: allMessages.length,
      summary: extracted.summary,
      preferences: extracted.preferences,
      openQuestions: extracted.openQuestions,
      promisedActions: extracted.promisedActions,
      source: "llm",
      contentHash,
      model,
      llmSyncedAt: new Date(),
    },
    update: {
      lastContactAt: allMessages[allMessages.length - 1]?.createdAt ?? null,
      messageCount: allMessages.length,
      summary: extracted.summary,
      preferences: extracted.preferences,
      openQuestions: extracted.openQuestions,
      promisedActions: extracted.promisedActions,
      source: "llm",
      contentHash,
      model,
      llmSyncedAt: new Date(),
    },
  })

  await recordAiUsageEvent({
    tenantId,
    feature: options.featureContext ? `person_memory.${options.featureContext}` : "person_memory.llm",
    model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(extracted)),
    status: "succeeded",
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "person_memory.synced_llm",
      payloadJson: {
        contactId,
        messageCount: allMessages.length,
      } as Prisma.InputJsonValue,
    },
  })

  return { status: "llm_completed", contentHash, model }
}
