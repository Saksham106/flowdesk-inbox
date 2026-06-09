import { prisma } from "@/lib/prisma"
import type { MessageDirection } from "@prisma/client"

export type StaleConversation = {
  id: string
  tenantId: string
  externalThreadId: string
  lastMessageAt: Date
  status: string
  label: string | null
  lastMessageDirection: MessageDirection
}

export async function getStaleConversations(
  tenantId: string,
  staleAfterDays: number
): Promise<StaleConversation[]> {
  const threshold = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000)

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
      lastMessageAt: { lt: threshold },
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { lastMessageAt: "asc" },
  })

  return conversations.map((conv) => ({
    id: conv.id,
    tenantId: conv.tenantId,
    externalThreadId: conv.externalThreadId,
    lastMessageAt: conv.lastMessageAt,
    status: conv.status,
    label: conv.label,
    lastMessageDirection: conv.messages[0]?.direction ?? "inbound",
  }))
}

export async function hasRecentFollowUpJob(
  conversationId: string,
  withinHours = 24
): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)
  const job = await prisma.agentJob.findFirst({
    where: {
      conversationId,
      trigger: "follow_up",
      createdAt: { gte: since },
    },
  })
  return !!job
}

export async function countFollowUpJobs(conversationId: string): Promise<number> {
  return prisma.agentJob.count({
    where: { conversationId, trigger: "follow_up" },
  })
}

export type FollowUpBatchResult = {
  processed: number
  skipped: number
  failed: number
}

export async function runFollowUpBatch(tenantId?: string): Promise<FollowUpBatchResult> {
  const settings = await prisma.followUpSetting.findMany({
    where: {
      enabled: true,
      ...(tenantId ? { tenantId } : {}),
    },
  })

  let processed = 0
  let skipped = 0
  let failed = 0

  for (const setting of settings) {
    const conversations = await getStaleConversations(setting.tenantId, setting.staleAfterDays)

    for (const conv of conversations) {
      try {
        const alreadyQueued = await hasRecentFollowUpJob(conv.id)
        if (alreadyQueued) {
          skipped++
          continue
        }

        const totalFollowUps = await countFollowUpJobs(conv.id)
        if (totalFollowUps >= setting.maxFollowUpsPerConversation) {
          skipped++
          continue
        }

        await prisma.agentJob.create({
          data: {
            tenantId: setting.tenantId,
            conversationId: conv.id,
            trigger: "follow_up",
          },
        })

        await prisma.auditLog.create({
          data: {
            tenantId: setting.tenantId,
            action: "follow_up.job_created",
            payloadJson: {
              conversationId: conv.id,
              lastMessageAt: conv.lastMessageAt.toISOString(),
              staleAfterDays: setting.staleAfterDays,
            },
          },
        })

        processed++
      } catch {
        failed++
      }
    }
  }

  return { processed, skipped, failed }
}
