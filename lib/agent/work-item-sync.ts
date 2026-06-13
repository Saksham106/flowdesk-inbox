import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { summarizeWorkItems, type WorkItemConversationInput } from "@/lib/agent/work-items"
import { syncPersonMemory } from "@/lib/agent/person-memory"
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"
import { classifySupportSignals } from "@/lib/agent/support-classifier"
import { classifySalesSignals } from "@/lib/agent/sales-classifier"
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { extractEmail } from "@/lib/google"

export type SyncConversationWorkItemsInput = {
  tenantId: string
  conversationId: string
  now?: Date
}

export type SyncConversationWorkItemsResult = {
  stateSynced: boolean
  tasksSynced: number
  leadSynced: boolean
  supportClassified: boolean
  salesClassified: boolean
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

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { accountType: true },
  })
  const isPersonal = tenant?.accountType === "personal"

  const kbDocs = (await prisma.knowledgeDocument.findMany({
    where: { tenantId: input.tenantId },
    select: { id: true, title: true, content: true },
    take: 50,
  })) ?? []

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

  // Auto-close automated/FYI conversations that were never engaged with
  const hasOutboundMessages = conversation.messages.some((m) => m.direction === "outbound")
  if (
    summary.state.state === "fyi_only" &&
    conversation.status === "needs_reply" &&
    !hasOutboundMessages
  ) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "closed" },
    })
  }

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

    // Fire-and-forget LLM scoring — business accounts only, does not block sync
    if (!isPersonal) {
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
  }

  if (conversation.contactId) {
    await syncPersonMemory(conversation.tenantId, conversation.contactId)
  }

  const supportSignals = classifySupportSignals(
    conversation.messages.map((m) => ({ direction: m.direction, body: m.body })),
    kbDocs,
    conversation.label
  )

  const existing = (await prisma.conversationState.findUnique({
    where: { conversationId: conversation.id },
    select: { metadataJson: true },
  }))?.metadataJson

  const existingMeta =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}

  await prisma.auditLog.create({
    data: {
      tenantId: conversation.tenantId,
      action: "conversation_state.support_classified",
      payloadJson: {
        conversationId: conversation.id,
        isSupport: supportSignals.isSupport,
        churnRisk: supportSignals.churnRisk,
        needsEscalation: supportSignals.needsEscalation,
        suggestedKbDocId: supportSignals.suggestedKbDocId,
      },
    },
  })

  let postSupportMeta: Record<string, unknown> = existingMeta

  if (supportSignals.isSupport || existingMeta.isSupport === true) {
    const updatedSupportMeta = {
      ...existingMeta,
      isSupport: supportSignals.isSupport,
      churnRisk: supportSignals.churnRisk,
      needsEscalation: supportSignals.needsEscalation,
      suggestedKbDocId: supportSignals.suggestedKbDocId,
    }
    await prisma.conversationState.update({
      where: { conversationId: conversation.id },
      data: {
        metadataJson: updatedSupportMeta as Prisma.InputJsonValue,
      },
    })
    postSupportMeta = updatedSupportMeta
  }

  let salesClassified = false
  if (!isPersonal) {
    const salesSignals = classifySalesSignals(
      conversation.messages.map((m) => ({ direction: m.direction, body: m.body }))
    )

    await prisma.auditLog.create({
      data: {
        tenantId: conversation.tenantId,
        action: "conversation_state.sales_classified",
        payloadJson: {
          conversationId: conversation.id,
          isSalesLead: salesSignals.isSalesLead,
          closingStage: salesSignals.closingStage,
        },
      },
    })

    if (salesSignals.isSalesLead) {
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          metadataJson: {
            ...postSupportMeta,
            isSalesLead: true,
            extractedBudget: salesSignals.extractedBudget,
            extractedTimeline: salesSignals.extractedTimeline,
            closingStage: salesSignals.closingStage,
            suggestedAction: salesSignals.suggestedAction,
          } as Prisma.InputJsonValue,
        },
      })
      salesClassified = true
    }
  }

  // Classify email type (notification / newsletter / marketing) for all accounts
  let detectedEmailType: string | null = null
  const firstInbound = conversation.messages.find((m) => m.direction === "inbound")
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const bodyText = firstInbound.body
    // When a message has no body, Gmail sync stores it as "[Subject text]"
    const subjectHint = /^\[(.+)\]$/.test(bodyText.trim()) ? bodyText.trim().slice(1, -1) : ""
    const { emailType } = classifyEmailType({
      fromEmail,
      subject: subjectHint,
      body: bodyText,
    })
    detectedEmailType = emailType

    if (emailType !== "needs_reply") {
      const currentState = await prisma.conversationState.findUnique({
        where: { conversationId: conversation.id },
        select: { metadataJson: true },
      })
      const currentMeta =
        currentState?.metadataJson &&
        typeof currentState.metadataJson === "object" &&
        !Array.isArray(currentState.metadataJson)
          ? (currentState.metadataJson as Record<string, unknown>)
          : {}

      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: { metadataJson: { ...currentMeta, emailType } as Prisma.InputJsonValue },
      })
    }
  }

  // Second-pass auto-close: classifyEmailType runs after summarizeWorkItems, so emails classified
  // as FYI by the email classifier (but not caught by pattern matching) need a second chance here.
  const AUTO_EMAIL_TYPES = new Set(["notification", "newsletter", "marketing"])
  if (
    detectedEmailType !== null &&
    AUTO_EMAIL_TYPES.has(detectedEmailType) &&
    summary.state.state !== "fyi_only" &&
    conversation.status === "needs_reply" &&
    !hasOutboundMessages
  ) {
    await prisma.conversationState.update({
      where: { conversationId: conversation.id },
      data: { state: "fyi_only", priority: "none", reason: "FYI only.", nextAction: "No action needed." },
    })
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "closed" },
    })
  }

  return {
    stateSynced: true,
    tasksSynced,
    leadSynced,
    supportClassified: supportSignals.isSupport,
    salesClassified,
  }
}
