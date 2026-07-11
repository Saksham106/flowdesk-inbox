import { BULK_LIST_PATTERN } from "@/lib/agent/email-classifier"
import { extractListUnsubscribeHeader } from "@/lib/agent/unsubscribe"
import { prisma } from "@/lib/prisma"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import {
  buildDraftEligibilityPrompt,
  draftEligibilityJsonSchema,
  normalizeDraftEligibilityOutput,
} from "@/lib/ai/prompts/draft-eligibility"
import type { AttentionCategory, EmailType } from "@/lib/agent/email-classifier"
import { estimateTokenCount } from "@/lib/ai/usage"

export function hasBulkMailSignals(input: { body: string; rawHeaders?: string }): boolean {
  if (BULK_LIST_PATTERN.test(input.body)) return true
  if (input.rawHeaders && extractListUnsubscribeHeader(input.rawHeaders)) return true
  return false
}

const FALLBACK_CONFIDENCE = 0.7

export type ResolveDraftEligibilityInput = {
  tenantId: string
  userId: string
  userEmail: string
  conversationId: string
  classification: {
    emailType: EmailType
    attentionCategory: AttentionCategory
    confidence: number
    reason: string
  }
  message: { subject: string; body: string; rawHeaders?: string }
}

export async function resolveDraftEligibility(
  input: ResolveDraftEligibilityInput
): Promise<{ eligible: boolean; reason: string }> {
  const { classification } = input

  if (classification.emailType !== "needs_reply" || classification.confidence > FALLBACK_CONFIDENCE) {
    return { eligible: true, reason: "Classification did not hit the ambiguous fallback bucket." }
  }

  if (hasBulkMailSignals(input.message)) {
    await retagConversation(input, {
      emailType: "newsletter",
      attentionCategory: "read_later",
      reason: "Bulk-mail signals (unsubscribe footer or header) present despite falling through the specific newsletter/marketing rules.",
    })
    return { eligible: false, reason: "Deterministic bulk-mail signals detected." }
  }

  const prompt = buildDraftEligibilityPrompt({
    subject: input.message.subject,
    body: input.message.body,
  })

  const { output } = await runAiJsonFeature<Record<string, unknown>>({
    tenantId: input.tenantId,
    userId: input.userId,
    userEmail: input.userEmail,
    feature: "draft_gate.eligibility",
    messages: [{ role: "user", content: prompt }],
    schemaName: "flowdesk_draft_eligibility",
    schema: draftEligibilityJsonSchema,
    estimatedInputTokens: estimateTokenCount(prompt),
    estimatedOutputTokens: 150,
  })

  const result = normalizeDraftEligibilityOutput(JSON.stringify(output))

  if (!result.needsReply) {
    await retagConversation(input, {
      emailType: result.suggestedEmailType,
      attentionCategory: result.suggestedAttentionCategory,
      reason: result.reason,
    })
    return { eligible: false, reason: result.reason }
  }

  return { eligible: true, reason: result.reason }
}

async function retagConversation(
  input: ResolveDraftEligibilityInput,
  correction: { emailType: EmailType; attentionCategory: AttentionCategory; reason: string }
): Promise<void> {
  const currentState = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { metadataJson: true },
  })
  const currentMeta =
    currentState?.metadataJson &&
    typeof currentState.metadataJson === "object" &&
    !Array.isArray(currentState.metadataJson)
      ? (currentState.metadataJson as Record<string, unknown>)
      : {}

  const updatedMeta = {
    ...currentMeta,
    emailType: correction.emailType,
    attentionCategory: correction.attentionCategory,
    attentionReason: correction.reason,
    attentionConfidence: 1,
    attentionSource: "draft_gate",
  }

  await prisma.conversationState.update({
    where: { conversationId: input.conversationId },
    data: { metadataJson: updatedMeta },
  })

  await projectFlowDeskLabelsForConversation({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "draft_gate.reclassified",
      payloadJson: {
        conversationId: input.conversationId,
        fromEmailType: "needs_reply",
        toEmailType: correction.emailType,
        toAttentionCategory: correction.attentionCategory,
        reason: correction.reason,
      },
    },
  })
}
