import type { Prisma } from "@prisma/client"
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText } from "@/lib/email-body"
import { runAiJsonFeature } from "@/lib/ai/gateway"
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
  // Background/tool caller has no session user in scope here — resolve the
  // tenant's earliest user as the owner for OpenRouter key + budget
  // attribution. No user for the tenant means AI sync can't run; degrade to
  // the deterministic summary rather than failing the whole sync.
  const owner = await prisma.user.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  })
  if (!owner) {
    await syncPersonMemory(tenantId, contactId)
    await recordAiUsageEvent({
      tenantId,
      feature: "person_memory.deterministic_fallback",
      model: "none",
      status: "skipped",
    })
    return { status: "deterministic", reason: "No user found for tenant; cannot route AI call" }
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
      model: "none",
      status: "skipped",
    })
    return { status: "cache_hit", contentHash }
  }

  const prompt = buildPersonMemoryExtractPrompt({
    contactName: contact.name,
    messages: allMessages,
  })

  let extracted: ReturnType<typeof normalizePersonMemoryExtractResult> = null
  let model = "unknown"
  const estimatedInputTokens = estimateTokenCount(prompt)

  try {
    const result = await runAiJsonFeature<Record<string, unknown>>({
      tenantId,
      userId: owner.id,
      userEmail: owner.email,
      feature: options.featureContext ? `person_memory.${options.featureContext}` : "person_memory.llm",
      messages: [{ role: "user", content: prompt }],
      schemaName: "flowdesk_person_memory_extract",
      schema: personMemoryExtractJsonSchema,
      estimatedInputTokens,
      estimatedOutputTokens: 500,
    })
    model = result.model
    extracted = normalizePersonMemoryExtractResult(result.output)
  } catch (err) {
    // runAiJsonFeature already records the AiUsageEvent (success/blocked/
    // failed) for this call under the same feature key, so we don't
    // double-record here.
    await syncPersonMemory(tenantId, contactId)
    const message = err instanceof Error ? err.message : "Failed to generate person memory"
    return {
      status: "llm_failed",
      reason: message,
    }
  }

  if (!extracted) {
    await syncPersonMemory(tenantId, contactId)
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
