import { prisma } from "@/lib/prisma"
import { evaluateAutonomy } from "@/lib/agent/autonomy"
import { getReplyGenerationContext } from "@/lib/agent/reply-context"
import { generateDraftReply } from "@/lib/ai/provider"
import { sendConversationMessage, ConversationSendError } from "@/lib/conversations/send-message"
import type { ClassifyResult } from "@/lib/ai/prompts/classify"
import type { PolicyDecision } from "@/lib/agent/policy"

export type AutopilotEligibility =
  | { eligible: true }
  | { eligible: false; reason: string }

export async function checkAutopilotEligibility(
  tenantId: string,
  classification: ClassifyResult,
  policy: PolicyDecision
): Promise<AutopilotEligibility> {
  // Policy must not require human approval — this is the AND gate, not a bypass
  if (policy.requiresApproval) {
    return { eligible: false, reason: `Policy requires approval: ${policy.reason ?? "high risk or low confidence"}` }
  }

  const setting = await prisma.autopilotSetting.findUnique({ where: { tenantId } })
  if (!setting?.enabled) {
    return { eligible: false, reason: "Autopilot is not enabled" }
  }

  if (setting.disabledAt) {
    return { eligible: false, reason: "Autopilot is disabled due to repeated failures" }
  }

  if (classification.confidence < setting.confidenceThreshold) {
    return {
      eligible: false,
      reason: `Confidence ${classification.confidence.toFixed(2)} is below threshold ${setting.confidenceThreshold}`,
    }
  }

  if (setting.allowedIntentsJson) {
    const allowed = setting.allowedIntentsJson as string[]
    if (Array.isArray(allowed) && allowed.length > 0) {
      const intentLower = classification.intent.toLowerCase()
      const match = allowed.some((a) => intentLower.includes(a.toLowerCase()))
      if (!match) {
        return {
          eligible: false,
          reason: `Intent "${classification.intent}" is not in the autopilot allow-list`,
        }
      }
    }
  }

  return { eligible: true }
}

export async function recordAutopilotFailure(tenantId: string): Promise<void> {
  const setting = await prisma.autopilotSetting.findUnique({ where: { tenantId } })
  if (!setting) return

  const newCount = setting.currentFailures + 1
  const shouldDisable = newCount >= setting.disableAfterFailures

  await prisma.autopilotSetting.update({
    where: { tenantId },
    data: {
      currentFailures: newCount,
      ...(shouldDisable ? { disabledAt: new Date() } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: shouldDisable ? "autopilot.disabled_after_failures" : "autopilot.failure_recorded",
      payloadJson: { failureCount: newCount, disabled: shouldDisable },
    },
  })
}

export async function recordAutopilotSuccess(tenantId: string): Promise<void> {
  await prisma.autopilotSetting.updateMany({
    where: { tenantId, currentFailures: { gt: 0 } },
    data: { currentFailures: 0 },
  })
}

export type AutopilotSendResult =
  | { sent: true; providerMessageId: string }
  | { sent: false; reason: string }

export async function attemptAutopilotSend(
  jobId: string,
  classification: ClassifyResult,
  policy: PolicyDecision
): Promise<AutopilotSendResult> {
  const job = await prisma.agentJob.findUnique({
    where: { id: jobId },
    include: {
      conversation: {
        include: {
          channel: true,
          messages: { orderBy: { createdAt: "asc" }, take: 40 },
        },
      },
    },
  })

  if (!job) return { sent: false, reason: "Job not found" }

  const eligibility = await checkAutopilotEligibility(job.tenantId, classification, policy)
  if (!eligibility.eligible) {
    return { sent: false, reason: eligibility.reason }
  }

  if (job.conversation.channel.type !== "email") {
    return { sent: false, reason: "Autopilot only supports email conversations" }
  }

  const context = await getReplyGenerationContext({
    tenantId: job.tenantId,
    channelId: job.conversation.channelId,
  })

  if (context.accountType === "business" && !context.businessProfile) {
    return { sent: false, reason: "Business profile not configured" }
  }

  const setting = await prisma.autopilotSetting.findUnique({ where: { tenantId: job.tenantId } })
  if (!setting) {
    return { sent: false, reason: "Autopilot is not enabled" }
  }

  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const dailyAutoSendCount = await prisma.auditLog.count({
    where: {
      tenantId: job.tenantId,
      action: "autopilot.send",
      createdAt: { gte: since },
    },
  })

  const autonomy = evaluateAutonomy({
    accountType: context.accountType,
    hasLearnedProfile: !!context.learnedProfile,
    autopilotEnabled: setting.enabled,
    confidence: classification.confidence,
    confidenceThreshold: setting.confidenceThreshold,
    riskLevel: classification.riskLevel,
    intent: classification.intent,
    escalationReason: classification.escalationReason,
    dailyAutoSendCount,
    maxAutoSendsPerDay: setting.maxAutoSendsPerDay,
    currentFailures: setting.currentFailures,
    disableAfterFailures: setting.disableAfterFailures,
  })

  if (!autonomy.eligible) {
    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "autopilot.held",
        payloadJson: {
          jobId,
          conversationId: job.conversationId,
          reason: autonomy.reason,
          accountType: context.accountType,
        },
      },
    })
    return { sent: false, reason: autonomy.reason }
  }

  const slots = Array.isArray(job.slotsJson) ? (job.slotsJson as string[]) : undefined

  let draftText: string
  try {
    const result = await generateDraftReply({
      businessProfile: context.businessProfile,
      knowledgeDocuments: context.knowledgeDocuments,
      learnedReplyProfile: context.learnedProfile,
      messages: job.conversation.messages,
      availableSlots: slots,
    })
    draftText = result.draftText
  } catch (err) {
    await recordAutopilotFailure(job.tenantId)
    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "autopilot.draft_failed",
        payloadJson: {
          jobId,
          conversationId: job.conversationId,
          error: err instanceof Error ? err.message : "Unknown error",
        },
      },
    })
    return { sent: false, reason: "Draft generation failed" }
  }

  // Upsert draft as approved
  const draft = await prisma.draft.upsert({
    where: { conversationId: job.conversationId },
    create: {
      conversationId: job.conversationId,
      text: draftText,
      status: "approved",
    },
    update: {
      text: draftText,
      status: "approved",
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: job.tenantId,
      action: "autopilot.draft_approved",
      payloadJson: {
        jobId,
        conversationId: job.conversationId,
        draftId: draft.id,
        intent: classification.intent,
        confidence: classification.confidence,
      },
    },
  })

  try {
    const sendResult = await sendConversationMessage({
      conversationId: job.conversationId,
      tenantId: job.tenantId,
      userId: null,
      text: draftText,
      auditAction: "autopilot.send",
    })

    await prisma.draft.update({
      where: { conversationId: job.conversationId },
      data: { status: "sent" },
    })

    await recordAutopilotSuccess(job.tenantId)

    return { sent: true, providerMessageId: sendResult.providerMessageId }
  } catch (err) {
    await recordAutopilotFailure(job.tenantId)

    const message =
      err instanceof ConversationSendError ? err.message : "Send failed"

    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "autopilot.send_failed",
        payloadJson: {
          jobId,
          conversationId: job.conversationId,
          error: message,
        },
      },
    })

    return { sent: false, reason: message }
  }
}
