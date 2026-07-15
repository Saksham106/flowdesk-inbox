import { BULK_LIST_PATTERN } from "@/lib/agent/email-classifier"
import { extractListUnsubscribeHeader } from "@/lib/agent/unsubscribe"
import { prisma } from "@/lib/prisma"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import { projectFlowDeskLabelsForConversation } from "@/lib/email-labels"
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
  /** Id of the inbound message being judged — keys the memoized decision. */
  messageId: string
  message: { subject: string; body: string; rawHeaders?: string }
}

// The persisted decision memo (metadataJson.draftGateDecision). The gate runs
// on every sync/push pass — without the memo it re-ran the AI judgment and
// re-issued the retag + label projection for the same message over and over
// (observed five times in 30s in prod), fighting the classifier's own
// persistence pass. A decision stands until a different inbound message id
// shows up; work-item-sync's classify block honors it the same way.
type DraftGateDecision = {
  messageId: string
  needsReply: boolean
  reason: string
  decidedAt: string
}

function decisionFromMetadata(meta: Record<string, unknown>): DraftGateDecision | null {
  const raw = meta.draftGateDecision
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.messageId !== "string" || typeof record.needsReply !== "boolean") return null
  return {
    messageId: record.messageId,
    needsReply: record.needsReply,
    reason: typeof record.reason === "string" ? record.reason : "",
    decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : "",
  }
}

export async function resolveDraftEligibility(
  input: ResolveDraftEligibilityInput
): Promise<{ eligible: boolean; reason: string }> {
  const { classification } = input

  const currentState = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { metadataJson: true, attentionCategory: true },
  })
  const currentMeta =
    currentState?.metadataJson &&
    typeof currentState.metadataJson === "object" &&
    !Array.isArray(currentState.metadataJson)
      ? (currentState.metadataJson as Record<string, unknown>)
      : {}

  // Explicit user correction always wins — the gate never overrides it.
  if (currentMeta.attentionCorrectedByUser === true || currentMeta.userOverride === true) {
    const correctedToNeedsReply =
      !currentState?.attentionCategory || currentState.attentionCategory === "needs_reply"
    return {
      eligible: correctedToNeedsReply,
      reason: "Conversation classification was explicitly corrected by the user; gate does not override it.",
    }
  }

  if (classification.emailType !== "needs_reply" || classification.confidence > FALLBACK_CONFIDENCE) {
    return { eligible: true, reason: "Classification did not hit the ambiguous fallback bucket." }
  }

  // Already judged this exact message: return the memoized decision instead of
  // re-running the AI and re-issuing the retag/projection.
  const previousDecision = decisionFromMetadata(currentMeta)
  if (previousDecision && previousDecision.messageId === input.messageId) {
    return {
      eligible: previousDecision.needsReply,
      reason: previousDecision.reason || "Draft gate already decided for this message.",
    }
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

  await recordGateDecision(input, { needsReply: true, reason: result.reason })
  return { eligible: true, reason: result.reason }
}

/** Persists the decision memo without touching classification fields. */
async function recordGateDecision(
  input: ResolveDraftEligibilityInput,
  decision: { needsReply: boolean; reason: string }
): Promise<void> {
  const currentState = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { metadataJson: true },
  })
  if (!currentState) return
  const currentMeta =
    currentState.metadataJson &&
    typeof currentState.metadataJson === "object" &&
    !Array.isArray(currentState.metadataJson)
      ? (currentState.metadataJson as Record<string, unknown>)
      : {}
  await prisma.conversationState.update({
    where: { conversationId: input.conversationId },
    data: {
      metadataJson: {
        ...currentMeta,
        draftGateDecision: {
          messageId: input.messageId,
          needsReply: decision.needsReply,
          reason: decision.reason,
          decidedAt: new Date().toISOString(),
        },
      },
    },
  })
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
    draftGateDecision: {
      messageId: input.messageId,
      needsReply: false,
      reason: correction.reason,
      decidedAt: new Date().toISOString(),
    },
  }

  await prisma.conversationState.update({
    where: { conversationId: input.conversationId },
    data: {
      metadataJson: updatedMeta,
      emailType: correction.emailType,
      attentionCategory: correction.attentionCategory,
    },
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
