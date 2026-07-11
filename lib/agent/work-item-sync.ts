import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { accountModeFor } from "@/lib/tenant-capabilities"
import { summarizeWorkItems, type WorkItemConversationInput } from "@/lib/agent/work-items"
import { syncPersonMemoryWithLLM } from "@/lib/agent/person-memory"
import { scoreLeadForConversation } from "@/lib/agent/lead-scoring"
import { classifySupportSignals } from "@/lib/agent/support-classifier"
import { classifySalesSignals } from "@/lib/agent/sales-classifier"
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { evaluatePersonMemoryPolicy } from "@/lib/ai/usage-policy"
import { recordAiUsageEvent } from "@/lib/ai/usage"
import { extractEmail } from "@/lib/google"
import { detectLifeAdminType } from "@/lib/agent/life-admin"
import { detectVip } from "@/lib/agent/vip-detector"
import { detectPhishing } from "@/lib/agent/phishing-detector"
import { extractListUnsubscribeHeader, parseUnsubscribeInfo } from "@/lib/agent/unsubscribe"
import { detectAttachments, extractPdfText } from "@/lib/agent/attachment-extractor"
import { extractFacts, mergeFacts } from "@/lib/agent/second-brain"
import { applyActiveRule } from "@/lib/agent/preference-learning"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import { userEditedFieldsFromMetadata } from "@/lib/agent/user-edited-fields"
import { detectSchedulingRequest } from "@/lib/agent/scheduling"
import { handleSchedulingConfirmationForInboundReply } from "@/lib/agent/scheduling-booking"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { hasGmailLabelOverride } from "@/lib/agent/gmail-label-feedback"
import {
  clearWaitingOnForInboundReply,
  markConversationWaitingOn,
  outboundMessageExpectsReply,
} from "@/lib/agent/follow-up"

export type SyncConversationWorkItemsInput = {
  tenantId: string
  conversationId: string
  now?: Date
  enableRichAi?: boolean
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
    select: { salesCrmEnabled: true },
  })
  const accountMode = accountModeFor(tenant)
  const isPersonal = accountMode === "personal"

  const kbDocs = isPersonal
    ? []
    : ((await prisma.knowledgeDocument.findMany({
        where: { tenantId: input.tenantId },
        select: { id: true, title: true, content: true },
        take: 50,
      })) ?? [])

  const summary = summarizeWorkItems(conversation as WorkItemConversationInput, input.now, {
    accountType: accountMode,
  })

  const initialState = await prisma.conversationState.findUnique({
    where: { conversationId: conversation.id },
    select: { source: true, metadataJson: true },
  })
  const initialMeta =
    initialState?.metadataJson &&
    typeof initialState.metadataJson === "object" &&
    !Array.isArray(initialState.metadataJson)
      ? (initialState.metadataJson as Record<string, unknown>)
      : {}
  const hasUserOverride =
    initialState?.source === "user_override" ||
    initialMeta.userOverride === true
  const hasLabelOverride = hasGmailLabelOverride(initialState?.metadataJson)
  const hasUserOverrideOrLabelHold =
    hasUserOverride || hasLabelOverride || conversation.status === "closed"

  if (!hasUserOverrideOrLabelHold) {
    const metadataJson = summary.state.metadata as Prisma.InputJsonValue
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
        metadataJson,
        ...conversationStateMetadataData(metadataJson),
      },
      update: {
        state: summary.state.state,
        priority: summary.state.priority,
        reason: summary.state.reason,
        nextAction: summary.state.nextAction,
        confidence: summary.state.confidence,
        source: summary.state.source,
        metadataJson,
        ...conversationStateMetadataData(metadataJson),
      },
    })
  }

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

  // Waiting-on lifecycle: a reply sent directly in Gmail (outside FlowDesk)
  // arrives here as the latest outbound message on a needs_reply conversation.
  // If it plausibly expects a response, move to waiting_on so the label
  // projection below picks it up. Conversely, an inbound message on a
  // waiting-on conversation self-heals it back to needs_reply and cancels any
  // scheduled follow-up. The conversation's `messages` include is capped at 40
  // ascending, so fetch the true latest message separately.
  let waitingOnLifecycleChanged = false
  const latestMessage = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    select: { direction: true, body: true },
  })
  if (
    !hasUserOverrideOrLabelHold &&
    latestMessage?.direction === "outbound" &&
    conversation.status === "needs_reply" &&
    outboundMessageExpectsReply(latestMessage.body)
  ) {
    try {
      await markConversationWaitingOn({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        detectedFrom: "gmail_sync",
      })
      waitingOnLifecycleChanged = true
    } catch (err) {
      console.error("[work-item-sync] waiting-on detection failed:", err)
    }
  } else if (
    latestMessage?.direction === "inbound" &&
    (conversation.userState === "waiting_on" || conversation.status === "in_progress")
  ) {
    try {
      await clearWaitingOnForInboundReply({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
      })
      waitingOnLifecycleChanged = true
    } catch (err) {
      console.error("[work-item-sync] waiting-on self-heal failed:", err)
    }
  }

  // Project FlowDesk state onto Gmail labels automatically after classification.
  // Self-guards for non-Google channels; best-effort so a Gmail hiccup never
  // fails the sync. Skipped when the user has overridden state manually — their
  // explicit choice is already projected by the status routes (the waiting-on
  // lifecycle transitions above re-project because they change the derived state).
  if ((!hasUserOverride || waitingOnLifecycleChanged) && !hasLabelOverride) {
    try {
      await projectFlowDeskLabelsForConversation({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
      })
    } catch (err) {
      console.error("[work-item-sync] Gmail label projection failed:", err)
    }
  }

  // Auto-close automated/FYI conversations that were never engaged with
  const hasOutboundMessages = conversation.messages.some((m) => m.direction === "outbound")
  if (
    summary.state.state === "fyi_only" &&
    !hasUserOverrideOrLabelHold &&
    conversation.status === "needs_reply" &&
    !hasOutboundMessages
  ) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "closed" },
    })
  }

  let tasksSynced = 0
  // User-edited fields win over sync refreshes (audit P1-5): a user edit
  // records the field in metadataJson.userEditedFields and flips source to
  // "user"; the update branch below skips those fields and carries the
  // ownership markers forward so they survive every subsequent sync.
  const existingTasks = summary.tasks.length
    ? await prisma.inboxTask.findMany({
        where: {
          tenantId: conversation.tenantId,
          deterministicKey: { in: summary.tasks.map((t) => t.deterministicKey) },
        },
        select: { deterministicKey: true, source: true, metadataJson: true },
      })
    : []
  const existingTaskByKey = new Map(existingTasks.map((t) => [t.deterministicKey, t]))

  for (const task of summary.tasks) {
    const existingTask = existingTaskByKey.get(task.deterministicKey)
    const userEditedFields = userEditedFieldsFromMetadata(existingTask?.metadataJson)
    const mergedMetadata = {
      ...task.metadata,
      ...(userEditedFields.length > 0 ? { userEditedFields } : {}),
    }

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
        ...(userEditedFields.includes("title") ? {} : { title: task.title }),
        ...(userEditedFields.includes("dueAt") ? {} : { dueAt: task.dueAt }),
        ...(existingTask?.source === "user" ? {} : { source: task.source }),
        sourceMessageId: task.sourceMessageId,
        metadataJson: mergedMetadata as Prisma.InputJsonValue,
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

  const supportSignals = isPersonal
    ? {
        isSupport: false,
        churnRisk: false,
        needsEscalation: false,
        suggestedKbDocId: null,
      }
    : classifySupportSignals(
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

  if (!isPersonal) {
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
  }

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
        ...conversationStateMetadataData(updatedSupportMeta),
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
      const updatedSalesMeta = {
        ...postSupportMeta,
        isSalesLead: true,
        extractedBudget: salesSignals.extractedBudget,
        extractedTimeline: salesSignals.extractedTimeline,
        closingStage: salesSignals.closingStage,
        suggestedAction: salesSignals.suggestedAction,
      }
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          metadataJson: updatedSalesMeta as Prisma.InputJsonValue,
          ...conversationStateMetadataData(updatedSalesMeta),
        },
      })
      salesClassified = true
    }
  }

  // Classify email attention for all accounts. This keeps the legacy emailType
  // while adding richer attention metadata for no-reply transactional messages.
  let detectedEmailType: string | null = null
  let detectedAttentionCategory: string | null = null
  let emailClassification: ReturnType<typeof classifyEmailType> | null = null
  const firstInbound = conversation.messages.find((m) => m.direction === "inbound")
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const bodyText = firstInbound.body
    // When a message has no body, Gmail sync stores it as "[Subject text]"
    const subjectHint = /^\[(.+)\]$/.test(bodyText.trim()) ? bodyText.trim().slice(1, -1) : ""
    emailClassification = classifyEmailType({
      fromEmail,
      subject: subjectHint,
      body: bodyText,
    })
    const {
      emailType,
      attentionCategory: classifiedAttention,
      reason,
      confidence,
      extractedCode,
      expiresIn,
      action,
    } = emailClassification
    detectedEmailType = emailType

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

    // Explicit user correction always wins — no rule or AI can override it.
    const isUserAttentionCorrected =
      currentMeta.attentionCorrectedByUser === true || currentMeta.userOverride === true

    // If user hasn't explicitly corrected, check whether an active SenderRule applies.
    // Rule wins over AI classification; explicit user correction (above) still wins over rule.
    let attentionCategory = classifiedAttention
    let attentionSource: "ai" | "rule" | "user" = "ai"
    if (!isUserAttentionCorrected) {
      const ruleAttention = await applyActiveRule({ tenantId: conversation.tenantId, fromEmail })
      if (ruleAttention) {
        attentionCategory = ruleAttention
        attentionSource = "rule"
      }
    }
    detectedAttentionCategory = attentionCategory

    const persistedAction = action
      ? {
          type: action.type,
          explanation: action.explanation,
          ...(action.actionLink ? { actionLink: action.actionLink } : {}),
          ...(action.expirationText ? { expirationText: action.expirationText } : {}),
          hasDetectedCode: Boolean(action.detectedCode),
          ...(action.detectedCode ? { detectedCode: action.detectedCode } : {}),
        }
      : null

    const updatedEmailMeta = {
      ...currentMeta,
      emailType,
      ...(isUserAttentionCorrected
        ? {}
        : { attentionCategory, attentionReason: attentionSource === "rule" ? "Applied from your learned preference rule." : reason, attentionConfidence: attentionSource === "rule" ? 1 : confidence, attentionSource }),
      ...(persistedAction ? { action: persistedAction } : {}),
      ...(expiresIn ? { expiresIn } : {}),
    }

    if (!hasLabelOverride) {
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          metadataJson: updatedEmailMeta as Prisma.InputJsonValue,
          ...conversationStateMetadataData(updatedEmailMeta),
        },
      })
    }

    if (!hasUserOverrideOrLabelHold && attentionCategory === "needs_action") {
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          state: "waiting_on_you",
          priority: "high",
          reason,
          nextAction: extractedCode
            ? "Use the verification code only in the service that requested it."
            : "Complete the requested account action.",
          confidence,
          source: "deterministic",
        },
      })
    } else if (!hasUserOverrideOrLabelHold && attentionCategory === "review_soon") {
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          state: "risky_urgent",
          priority: "high",
          reason,
          nextAction: "Review the alert and decide whether action is needed.",
          confidence,
          source: "deterministic",
        },
      })
    } else if (!hasUserOverrideOrLabelHold && attentionCategory === "read_later") {
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          state: "fyi_only",
          priority: "low",
          reason,
          nextAction: "Read later if relevant.",
          confidence,
          source: "deterministic",
        },
      })
    }
  }

  // Life admin detection — runs for all accounts
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const lifeAdminResult = detectLifeAdminType(
      fromEmail,
      firstInbound.body.slice(0, 200),
      firstInbound.body
    )
    if (lifeAdminResult.type) {
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
        data: {
          metadataJson: {
            ...currentMeta,
            lifeAdminType: lifeAdminResult.type,
            lifeAdminAmount: lifeAdminResult.amount ?? null,
            lifeAdminCurrency: lifeAdminResult.currency ?? null,
          } as Prisma.InputJsonValue,
        },
      })
      // Create InboxTask for actionable life-admin types
      if (["bill_due", "medical_appointment", "subscription_renewal"].includes(lifeAdminResult.type)) {
        const taskTitle =
          lifeAdminResult.type === "bill_due"
            ? `Pay bill${lifeAdminResult.amount ? ` — $${lifeAdminResult.amount}` : ""}`
            : lifeAdminResult.type === "medical_appointment"
            ? "Medical appointment"
            : `Subscription renewal${lifeAdminResult.amount ? ` — $${lifeAdminResult.amount}` : ""}`
        const deterministicKey = `life_admin:${conversation.id}:${lifeAdminResult.type}`
        await prisma.inboxTask.upsert({
          where: {
            tenantId_deterministicKey: {
              tenantId: conversation.tenantId,
              deterministicKey,
            },
          },
          create: {
            tenantId: conversation.tenantId,
            conversationId: conversation.id,
            title: taskTitle,
            status: "open",
            source: "deterministic",
            deterministicKey,
            metadataJson: { lifeAdminType: lifeAdminResult.type } as Prisma.InputJsonValue,
          },
          update: { title: taskTitle },
        })
      }
    }
  }

  // VIP detection
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const vipResult = await detectVip(fromEmail, conversation.tenantId)
    if (vipResult.isVip) {
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
        data: {
          priority: "urgent",
          metadataJson: {
            ...currentMeta,
            isVip: true,
            vipLabel: vipResult.label ?? null,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }

  // Scheduling detection
  const latestInbound = conversation.messages
    .filter((m) => m.direction === "inbound")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

  if (latestInbound) {
    const isSchedulingRequest = detectSchedulingRequest(
      latestInbound.subject ?? "",
      latestInbound.body
    )
    if (isSchedulingRequest) {
      const existingSession = await prisma.schedulingSession.findUnique({
        where: { conversationId: conversation.id },
      })
      if (!existingSession) {
        await prisma.schedulingSession.create({
          data: {
            tenantId: input.tenantId,
            conversationId: conversation.id,
            status: "detecting",
          },
        })
      }
    }

    // Confirmation detection: if this conversation has a session in
    // `proposing` and the inbound reply agrees to one of the proposed slots,
    // confirm the session and book (Level 5) or raise a book_event approval.
    // Best-effort — a scheduling hiccup never fails the sync.
    try {
      await handleSchedulingConfirmationForInboundReply({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        inboundBody: latestInbound.body,
      })
    } catch (err) {
      console.error("[work-item-sync] scheduling confirmation detection failed:", err)
    }
  }

  // Phishing detection
  if (firstInbound) {
    const fromHeader = firstInbound.fromE164 ?? ""
    const fromEmail = extractEmail(fromHeader)
    const phishingResult = detectPhishing(
      fromHeader,
      fromEmail,
      firstInbound.body.slice(0, 200),
      firstInbound.body
    )
    if (phishingResult.verdict !== "safe") {
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
      if (!currentMeta.phishingMarkedSafe) {
        await prisma.conversationState.update({
          where: { conversationId: conversation.id },
          data: {
            metadataJson: {
              ...currentMeta,
              phishingVerdict: phishingResult.verdict,
              phishingScore: phishingResult.score,
              phishingSignals: phishingResult.signals,
            } as Prisma.InputJsonValue,
          },
        })
      }
    }
  }

  // Unsubscribe detection
  if (firstInbound) {
    const listUnsubscribeHeader = extractListUnsubscribeHeader(firstInbound.body)
    const unsubInfo = parseUnsubscribeInfo(listUnsubscribeHeader, firstInbound.body)
    if (unsubInfo.hasUnsubscribeLink) {
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
        data: {
          metadataJson: {
            ...currentMeta,
            hasUnsubscribeLink: true,
            unsubscribeUrl: unsubInfo.unsubscribeUrl,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }

  // Attachment detection (fire-and-forget — doesn't block sync)
  void (async () => {
    for (const message of conversation.messages) {
      const rawBody = message.body
      if (!rawBody) continue
      const detected = detectAttachments(rawBody)
      for (const att of detected) {
        const existing = await prisma.emailAttachment.findFirst({
          where: { messageId: message.id, filename: att.filename },
          select: { id: true },
        })
        if (existing) continue

        let extractedText: string | undefined
        if (att.mimeType === "application/pdf" && att.base64Data) {
          try {
            extractedText = await extractPdfText(att.base64Data)
          } catch {
            // PDF extraction is best-effort
          }
        }

        await prisma.emailAttachment.create({
          data: {
            tenantId: conversation.tenantId,
            messageId: message.id,
            conversationId: conversation.id,
            filename: att.filename,
            mimeType: att.mimeType,
            extractedText: extractedText ?? null,
          },
        })
      }
    }
  })().catch((err) => {
    console.error("[work-item-sync] attachment extraction failed:", err)
  })

  // Second Brain — extract facts from first inbound and store in PersonMemory
  void (async () => {
    if (!firstInbound || !conversation.contactId) return
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    if (!fromEmail) return

    const subject = firstInbound.body.slice(0, 200)
    const newFacts = extractFacts(fromEmail, subject, firstInbound.body)
    if (newFacts.length === 0) return

    const existingMemory = await prisma.personMemory.findUnique({
      where: { contactId: conversation.contactId },
      select: { id: true, factsJson: true },
    })

    if (existingMemory) {
      const existingFacts = Array.isArray(existingMemory.factsJson)
        ? (existingMemory.factsJson as import("@/lib/agent/second-brain").ExtractedFact[])
        : []
      const merged = mergeFacts(existingFacts, newFacts)
      await prisma.personMemory.update({
        where: { id: existingMemory.id },
        data: { factsJson: merged as Prisma.InputJsonValue },
      })
    } else {
      await prisma.personMemory.create({
        data: {
          tenantId: conversation.tenantId,
          contactId: conversation.contactId,
          factsJson: newFacts as Prisma.InputJsonValue,
        },
      })
    }
  })().catch((err) => {
    console.error("[work-item-sync] second-brain fact extraction failed:", err)
  })

  // Second-pass auto-close: classifyEmailType runs after summarizeWorkItems, so emails classified
  // as FYI by the email classifier (but not caught by pattern matching) need a second chance here.
  const AUTO_CLOSE_ATTENTION_CATEGORIES = new Set(["quiet", "fyi_done"])
  if (
    detectedEmailType !== null &&
    detectedAttentionCategory !== null &&
    AUTO_CLOSE_ATTENTION_CATEGORIES.has(detectedAttentionCategory) &&
    !hasUserOverrideOrLabelHold &&
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

  if (conversation.contactId && input.enableRichAi !== false) {
    const memoryPolicy = evaluatePersonMemoryPolicy({
      conversation: {
        id: conversation.id,
        label: conversation.label,
        status: conversation.status,
        contactId: conversation.contactId,
        messages: conversation.messages.map((message) => ({
          direction: message.direction,
          body: message.body,
        })),
      },
      accountType: accountMode,
      emailClassification,
      isSalesLead: salesClassified,
      isSupport: supportSignals.isSupport,
    })

    if (memoryPolicy.shouldRunLLM) {
      await syncPersonMemoryWithLLM(conversation.tenantId, conversation.contactId, {
        featureContext: "work_item_sync",
      })
    } else {
      await recordAiUsageEvent({
        tenantId: conversation.tenantId,
        feature: "person_memory.policy_skipped",
        model: "none",
        status: "skipped",
      })
      await prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          action: "ai.person_memory.skipped",
          payloadJson: {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            tier: memoryPolicy.tier,
            reason: memoryPolicy.reason,
            emailType: emailClassification?.emailType ?? null,
            attentionCategory: emailClassification?.attentionCategory ?? null,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }

  return {
    stateSynced: true,
    tasksSynced,
    leadSynced,
    supportClassified: supportSignals.isSupport,
    salesClassified,
  }
}
