import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { summarizeWorkItems, type WorkItemConversationInput } from "@/lib/agent/work-items"
import { syncPersonMemory } from "@/lib/agent/person-memory"
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"

export type SyncConversationWorkItemsInput = {
  tenantId: string
  conversationId: string
  now?: Date
}

export type SyncConversationWorkItemsResult = {
  stateSynced: boolean
  tasksSynced: number
  leadSynced: boolean
}

export async function syncConversationWorkItems(
  input: SyncConversationWorkItemsInput
): Promise<SyncConversationWorkItemsResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    include: {
      contact: true,
      channel: true,
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
      draft: true,
      approvalRequests: {
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      calendarHolds: {
        where: { status: "held" },
        orderBy: { expiresAt: "asc" },
        take: 5,
      },
    },
  })

  if (!conversation) {
    throw new Error("Conversation not found or does not belong to this tenant")
  }

  const summary = summarizeWorkItems(conversation as WorkItemConversationInput, input.now)

  await prisma.conversationState.upsert({
    where: { conversationId: conversation.id },
    create: {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      state: summary.state.state,
      priority: summary.state.priority,
      reason: summary.state.reason,
      nextAction: summary.state.nextAction,
      confidence: summary.state.confidence,
      source: summary.state.source,
      metadataJson: summary.state.metadata as Prisma.InputJsonValue,
    },
    update: {
      state: summary.state.state,
      priority: summary.state.priority,
      reason: summary.state.reason,
      nextAction: summary.state.nextAction,
      confidence: summary.state.confidence,
      source: summary.state.source,
      metadataJson: summary.state.metadata as Prisma.InputJsonValue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: conversation.tenantId,
      action: "conversation_state.synced",
      payloadJson: {
        conversationId: conversation.id,
        state: summary.state.state,
        priority: summary.state.priority,
      },
    },
  })

  let tasksSynced = 0
  for (const task of summary.tasks) {
    await prisma.inboxTask.upsert({
      where: {
        tenantId_deterministicKey: {
          tenantId: conversation.tenantId,
          deterministicKey: task.deterministicKey,
        },
      },
      create: {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        source: task.source,
        sourceMessageId: task.sourceMessageId,
        deterministicKey: task.deterministicKey,
        metadataJson: task.metadata as Prisma.InputJsonValue,
      },
      update: {
        title: task.title,
        dueAt: task.dueAt,
        source: task.source,
        sourceMessageId: task.sourceMessageId,
        metadataJson: task.metadata as Prisma.InputJsonValue,
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: conversation.tenantId,
        action: "inbox_task.synced",
        payloadJson: {
          conversationId: conversation.id,
          deterministicKey: task.deterministicKey,
          title: task.title,
        },
      },
    })

    tasksSynced++
  }

  let leadSynced = false
  if (summary.lead) {
    await prisma.lead.upsert({
      where: {
        tenantId_conversationId: {
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
        },
      },
      create: {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        name: summary.lead.name,
        company: summary.lead.company,
        need: summary.lead.need,
        urgency: summary.lead.urgency,
        budgetClue: summary.lead.budgetClue,
        contactInfo: summary.lead.contactInfo,
        nextAction: summary.lead.nextAction,
        score: summary.lead.score,
        stage: summary.lead.stage,
        source: summary.lead.source,
        metadataJson: summary.lead.metadata as Prisma.InputJsonValue,
      },
      update: {
        name: summary.lead.name,
        company: summary.lead.company,
        need: summary.lead.need,
        urgency: summary.lead.urgency,
        budgetClue: summary.lead.budgetClue,
        contactInfo: summary.lead.contactInfo,
        nextAction: summary.lead.nextAction,
        score: summary.lead.score,
        source: summary.lead.source,
        metadataJson: summary.lead.metadata as Prisma.InputJsonValue,
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: conversation.tenantId,
        action: "lead.synced",
        payloadJson: {
          conversationId: conversation.id,
          score: summary.lead.score,
          company: summary.lead.company,
        },
      },
    })

    leadSynced = true

    // Fire-and-forget LLM scoring — does not block sync
    const upsertedLead = await prisma.lead.findFirst({
      where: { tenantId: conversation.tenantId, conversationId: conversation.id },
      select: { id: true },
    })
    if (upsertedLead) {
      void scoreLeadForConversation(conversation.tenantId, upsertedLead.id).catch(() => {
        // Scoring failures are silent — the heuristic score remains
      })
    }
  }

  if (conversation.contactId) {
    await syncPersonMemory(conversation.tenantId, conversation.contactId)
  }

  return { stateSynced: true, tasksSynced, leadSynced }
}
