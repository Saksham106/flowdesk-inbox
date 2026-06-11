import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

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
    },
    update: {
      lastContactAt: draft.lastContactAt,
      messageCount: draft.messageCount,
      summary: draft.summary,
      preferences: draft.preferences,
      openQuestions: draft.openQuestions,
      promisedActions: draft.promisedActions,
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
