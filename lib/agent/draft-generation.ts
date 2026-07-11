import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"
import { getReplyGenerationContext } from "@/lib/agent/reply-context"
import { generateDraftReply } from "@/lib/ai/provider"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import {
  buildDraftReplyPrompt,
  buildPersonalDraftReplyPrompt,
  draftReplyJsonSchema,
  normalizeDraftReplyOutput,
} from "@/lib/ai/prompts/draft-reply"
import { summarizeConversation } from "@/lib/ai/summarize"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import { revalidateInboxViews } from "@/lib/cache-tags"
import { conversationUpdateForDraftReady } from "@/lib/workflow-status-transitions"
import { latestMeaningfulInboundMessage, queueGmailDraftWriteback } from "@/lib/gmail-drafts"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { ensureDraftApprovalRequest } from "@/lib/agent/approvals"
import { validateDraftWritingPreferences } from "@/lib/agent/writing-preferences"
import { resolveDraftEligibility } from "@/lib/agent/draft-eligibility"
import { sanitizeDraftText } from "@/lib/agent/draft-sanitizer"

const VALID_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const

type DraftRecord = {
  id: string
  text: string
  status: string
  metadataJson?: unknown
}

export type ProposeDraftInput = {
  tenantId: string
  conversationId: string
  userId?: string
  userEmail?: string
  userInstruction?: string | null
  source: "manual" | "automatic" | "backfill"
}

export type ProposeDraftResult =
  | { status: "drafted"; draftId: string; draft: DraftRecord }
  | { status: "gated_out"; reason: string }
  | { status: "not_applicable"; reason: string }
  | { status: "error"; message: string }
  | { status: "writing_preference_violation"; message: string; validationFailures: string[] }

export async function proposeDraftForConversation(
  input: ProposeDraftInput
): Promise<ProposeDraftResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    include: {
      channel: true,
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
      draft: true,
    },
  })

  if (!conversation) return { status: "not_applicable", reason: "Conversation not found" }
  if (conversation.channel.type !== "email") {
    return { status: "not_applicable", reason: "AI drafts are only available for email conversations" }
  }

  if (input.source !== "manual") {
    const firstInbound = conversation.messages.find((m) => m.direction === "inbound")
    if (firstInbound) {
      const classification = classifyEmailType({
        fromEmail: firstInbound.fromE164 ?? "",
        subject: "",
        body: firstInbound.body,
      })
      const eligibility = await resolveDraftEligibility({
        tenantId: input.tenantId,
        userId: input.userId ?? "",
        userEmail: input.userEmail ?? "",
        conversationId: conversation.id,
        classification,
        message: { subject: "", body: firstInbound.body },
      })
      if (!eligibility.eligible) {
        return { status: "gated_out", reason: eligibility.reason }
      }
    }
  }

  const context = await getReplyGenerationContext({
    tenantId: input.tenantId,
    channelId: conversation.channelId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
  })
  const accountType = context.accountType
  const conversationSummary = summarizeConversation(conversation.messages)
  const learnedProfileId = context.learnedProfile?.id ?? null
  const learnedProfilePromptVersion = context.learnedProfile?.promptVersion ?? null

  let result: Awaited<ReturnType<typeof generateDraftReply>>
  let promptVersion: string
  let knowledgeDocumentIds: string[] = []
  let draftCacheKey: string

  try {
    if (accountType === "personal") {
      promptVersion = "personal-draft-v1"
      const prompt = buildPersonalDraftReplyPrompt({
        personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
        messages: conversation.messages,
        conversationSummary,
        userInstruction: input.userInstruction ?? null,
        writingPreferences: context.writingPreferences,
      })
      draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)

      // Only the manual, user-triggered path benefits from returning a
      // cached draft as-is — automatic/backfill callers only run when a
      // fresh inbound message just arrived, so a cache hit there would mean
      // "nothing changed," which their caller already guards against via
      // conversation.draft being null.
      if (input.source === "manual") {
        const cached = await cachedDraftResult({
          tenantId: input.tenantId,
          userId: input.userId,
          conversationId: conversation.id,
          draft: conversation.draft,
          draftCacheKey,
        })
        if (cached) return cached
      }

      const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
        tenantId: input.tenantId,
        userId: input.userId ?? "",
        userEmail: input.userEmail ?? "",
        feature: "autopilot.draft",
        messages: [{ role: "user", content: prompt }],
        schemaName: "flowdesk_draft_reply",
        schema: draftReplyJsonSchema,
        estimatedInputTokens: estimateTokenCount(prompt),
        estimatedOutputTokens: 500,
      })
      result = normalizeDraftReplyOutput(JSON.stringify(output), model)
    } else {
      if (!context.businessProfile) {
        return { status: "not_applicable", reason: "Business profile is required before generating drafts" }
      }
      promptVersion = context.learnedProfile ? "business-draft-learned-v1" : "ai-draft-mvp-v1"
      knowledgeDocumentIds = context.knowledgeDocuments.map((doc) => doc.id)

      const latestJob = await prisma.agentJob.findFirst({
        where: { conversationId: conversation.id, tenantId: input.tenantId, status: "completed" },
        orderBy: { completedAt: "desc" },
      })
      const availableSlots = Array.isArray(latestJob?.slotsJson)
        ? (latestJob.slotsJson as string[])
        : undefined

      const draftInput = {
        aiContext: { tenantId: input.tenantId, userId: input.userId ?? "", userEmail: input.userEmail ?? "" },
        businessProfile: context.businessProfile,
        knowledgeDocuments: context.knowledgeDocuments,
        learnedReplyProfile: context.learnedProfile,
        messages: conversation.messages,
        conversationSummary,
        availableSlots,
        userInstruction: input.userInstruction ?? null,
        writingPreferences: context.writingPreferences,
      }
      const prompt = buildDraftReplyPrompt(draftInput)
      draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)

      if (input.source === "manual") {
        const cached = await cachedDraftResult({
          tenantId: input.tenantId,
          userId: input.userId,
          conversationId: conversation.id,
          draft: conversation.draft,
          draftCacheKey,
        })
        if (cached) return cached
      }

      result = await generateDraftReply(draftInput)
    }
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Failed to generate AI draft" }
  }

  const writingPreferenceFailures = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
  if (writingPreferenceFailures.length > 0) {
    try {
      if (accountType === "personal") {
        const retryPrompt = buildPersonalDraftReplyPrompt({
          personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
          messages: conversation.messages,
          conversationSummary,
          userInstruction: input.userInstruction ?? null,
          writingPreferences: context.writingPreferences,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
        const { output, model } = await runAiJsonFeature<Record<string, unknown>>({
          tenantId: input.tenantId,
          userId: input.userId ?? "",
          userEmail: input.userEmail ?? "",
          feature: "autopilot.draft",
          messages: [{ role: "user", content: retryPrompt }],
          schemaName: "flowdesk_draft_reply",
          schema: draftReplyJsonSchema,
          estimatedInputTokens: estimateTokenCount(retryPrompt),
          estimatedOutputTokens: 500,
        })
        result = normalizeDraftReplyOutput(JSON.stringify(output), model)
      } else if (context.businessProfile) {
        result = await generateDraftReply({
          aiContext: { tenantId: input.tenantId, userId: input.userId ?? "", userEmail: input.userEmail ?? "" },
          businessProfile: context.businessProfile,
          knowledgeDocuments: context.knowledgeDocuments,
          learnedReplyProfile: context.learnedProfile,
          messages: conversation.messages,
          conversationSummary,
          userInstruction: input.userInstruction ?? null,
          writingPreferences: context.writingPreferences,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
      }
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "Failed to regenerate AI draft" }
    }

    // Only the manual path errors out to the user on a second violation — it's
    // the only caller with someone waiting on a synchronous response.
    // Automatic/backfill callers accept the second attempt as-is; anything
    // still wrong with it is the sanitizer's and the approval queue's job to
    // catch, same as today's writing-preference behavior for those paths
    // (which didn't exist before this feature, so there's no regression).
    if (input.source === "manual") {
      const remaining = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
      if (remaining.length > 0) {
        return {
          status: "writing_preference_violation",
          message: "Draft requires review because it violates writing preferences.",
          validationFailures: remaining,
        }
      }
    }
  }

  const sanitized = sanitizeDraftText(result.draftText)

  const suggestedLabel = accountType === "business" ? result.suggestedLabel : null
  const conversationText = conversation.messages.map((m) => m.body).join("\n")
  const sensitiveMatches = detectSensitiveMatches(conversationText)
  const sourceInbound = latestMeaningfulInboundMessage(conversation.messages)
  const existingDraftMetadata =
    conversation.draft?.metadataJson &&
    typeof conversation.draft.metadataJson === "object" &&
    !Array.isArray(conversation.draft.metadataJson)
      ? (conversation.draft.metadataJson as Record<string, unknown>)
      : {}

  const metadataJson = {
    intent: result.intent,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    suggestedLabel,
    escalationReason: result.escalationReason,
    model: result.model,
    promptVersion,
    accountType,
    learnedProfileId,
    learnedProfilePromptVersion,
    autoSendEligible: false,
    autoSendHoldReason: "manual_draft_suggestion",
    knowledgeDocumentIds,
    source: input.source,
    draftCacheKey,
    ...(input.userInstruction ? { userInstruction: input.userInstruction } : {}),
    ...(sensitiveMatches.length > 0 ? { sensitiveMatches } : {}),
    ...(sanitized.autoFixed.length > 0 ? { sanitizerAutoFixed: sanitized.autoFixed } : {}),
    ...(sanitized.flagged.length > 0 ? { sanitizerFlags: sanitized.flagged } : {}),
    ...(sourceInbound
      ? {
          sourceInboundMessageId: sourceInbound.providerMessageId,
          sourceInboundAt: sourceInbound.createdAt.toISOString(),
        }
      : {}),
    ...(typeof existingDraftMetadata.gmailDraftId === "string"
      ? { gmailDraftId: existingDraftMetadata.gmailDraftId }
      : {}),
    ...(typeof existingDraftMetadata.gmailDraftSourceInboundMessageId === "string"
      ? { gmailDraftSourceInboundMessageId: existingDraftMetadata.gmailDraftSourceInboundMessageId }
      : {}),
    ...(typeof existingDraftMetadata.gmailDraftSourceInboundAt === "string"
      ? { gmailDraftSourceInboundAt: existingDraftMetadata.gmailDraftSourceInboundAt }
      : {}),
  }

  const draft = await prisma.draft.upsert({
    where: { conversationId: conversation.id },
    create: { conversationId: conversation.id, text: sanitized.text, status: "proposed", metadataJson },
    update: { text: sanitized.text, status: "proposed", metadataJson },
  })

  await ensureDraftApprovalRequest({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    draftId: draft.id,
    source: `draft_suggest_${input.source}`,
  })

  if (accountType === "business" && suggestedLabel && VALID_LABELS.includes(suggestedLabel)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { label: suggestedLabel, ...conversationUpdateForDraftReady() },
    })
  } else {
    await prisma.conversation.update({ where: { id: conversation.id }, data: conversationUpdateForDraftReady() })
  }

  if (conversation.channel.provider === "google" && conversation.externalThreadId) {
    try {
      await queueGmailDraftWriteback({
        tenantId: input.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        threadId: conversation.externalThreadId,
      })
      await projectFlowDeskLabelsForConversation({ tenantId: input.tenantId, conversationId: conversation.id })
    } catch (err) {
      console.error("[draft-generation] Gmail draft/label writeback failed:", err)
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      ...(input.userId ? { userId: input.userId } : {}),
      action: "draft.suggest",
      payloadJson: { conversationId: conversation.id, draftId: draft.id, accountType, source: input.source, metadata: metadataJson },
    },
  })

  revalidateInboxViews(input.tenantId, conversation.id)
  return { status: "drafted", draftId: draft.id, draft }
}

function learnedProfileToPersonalStyle(profile: {
  styleSummaryJson?: unknown
  exampleSnippetsJson?: unknown
} | null) {
  if (!profile || typeof profile.styleSummaryJson !== "object" || profile.styleSummaryJson === null) {
    return null
  }
  const style = profile.styleSummaryJson as Record<string, unknown>
  const snippets = Array.isArray(profile.exampleSnippetsJson)
    ? profile.exampleSnippetsJson.filter((item): item is string => typeof item === "string").join("\n")
    : null
  return {
    toneSummary: typeof style.tone === "string" ? style.tone : null,
    greetingPatterns: typeof style.greetings === "string" ? style.greetings : null,
    signoffPatterns: typeof style.signoffs === "string" ? style.signoffs : null,
    sentenceLengthStyle: typeof style.length === "string" ? style.length : null,
    formalityLevel: typeof style.formality === "string" ? style.formality : null,
    recurringPhrasesToUse: Array.isArray(style.commonPhrases)
      ? style.commonPhrases.filter((item): item is string => typeof item === "string")
      : [],
    recurringPhrasesToAvoid: Array.isArray(style.thingsToAvoid)
      ? style.thingsToAvoid.filter((item): item is string => typeof item === "string")
      : [],
    sanitizedExamples: snippets,
  }
}

function buildDraftCacheKey(promptVersion: string, accountType: string, prompt: string): string {
  return createHash("sha256").update(`${promptVersion}\n${accountType}\n${prompt}`).digest("hex")
}

// Reproduces the original route's maybeReturnCachedDraft side effects (audit
// log, approval-request refresh, cache-hit usage event, workflow status)
// while returning a ProposeDraftResult instead of a NextResponse. The
// returned draft's metadataJson carries `cacheHit: true` for the caller's
// response payload; it is not persisted back to the database (matching the
// original route, which also only reflected cacheHit in the HTTP response).
async function cachedDraftResult(input: {
  tenantId: string
  userId?: string
  conversationId: string
  draft: DraftRecord | null
  draftCacheKey: string
}): Promise<{ status: "drafted"; draftId: string; draft: DraftRecord } | null> {
  const metadata =
    input.draft?.metadataJson &&
    typeof input.draft.metadataJson === "object" &&
    !Array.isArray(input.draft.metadataJson)
      ? (input.draft.metadataJson as Record<string, unknown>)
      : null

  if (
    input.draft?.status !== "proposed" ||
    !input.draft.text.trim() ||
    metadata?.draftCacheKey !== input.draftCacheKey
  ) {
    return null
  }

  const meta = { ...metadata, cacheHit: true }

  await ensureDraftApprovalRequest({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    draftId: input.draft.id,
    source: "draft_suggest_cache_hit",
  })
  await recordAiUsageEvent({
    tenantId: input.tenantId,
    feature: "draft.suggest.cache_hit",
    model: typeof metadata?.model === "string" ? metadata.model : "none",
    status: "skipped",
  })
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      ...(input.userId ? { userId: input.userId } : {}),
      action: "draft.suggest.cache_hit",
      payloadJson: { conversationId: input.conversationId, draftId: input.draft.id },
    },
  })
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: conversationUpdateForDraftReady(),
  })

  return { status: "drafted", draftId: input.draft.id, draft: { ...input.draft, metadataJson: meta } }
}
