import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { createHash } from "crypto"

import { authOptions } from "@/lib/auth"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"
import { getReplyGenerationContext } from "@/lib/agent/reply-context"
import { generateDraftReply } from "@/lib/ai/provider"
import { runAiJsonFeature } from "@/lib/ai/gateway"
import { buildDraftReplyPrompt, buildPersonalDraftReplyPrompt, draftReplyJsonSchema, normalizeDraftReplyOutput } from "@/lib/ai/prompts/draft-reply"
import { summarizeConversation } from "@/lib/ai/summarize"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import { prisma } from "@/lib/prisma"
import { revalidateInboxViews } from "@/lib/cache-tags"
import { conversationUpdateForDraftReady } from "@/lib/workflow-status-transitions"
import { latestMeaningfulInboundMessage, queueGmailDraftWriteback } from "@/lib/gmail-drafts"
import { projectFlowDeskLabelsForConversation } from "@/lib/gmail-labels"
import { ensureDraftApprovalRequest } from "@/lib/agent/approvals"
import { validateDraftWritingPreferences } from "@/lib/agent/writing-preferences"

export const runtime = "nodejs"

const VALID_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const
const MAX_USER_INSTRUCTION_LENGTH = 500

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: params.id,
      tenantId: session.user.tenantId,
    },
    include: {
      channel: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 40,
      },
      draft: true,
    },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  if (conversation.channel.type !== "email") {
    return NextResponse.json({ error: "AI drafts are only available for email conversations" }, { status: 400 })
  }

  const userInstruction = await parseUserInstruction(request)
  if (userInstruction instanceof NextResponse) {
    return userInstruction
  }

  const context = await getReplyGenerationContext({
    tenantId: session.user.tenantId,
    channelId: conversation.channelId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
  })
  const accountType = context.accountType

  // Summarize conversation for RAG-enhanced prompts
  const conversationSummary = summarizeConversation(conversation.messages)

  let result: Awaited<ReturnType<typeof generateDraftReply>>
  let promptVersion: string
  let knowledgeDocumentIds: string[] = []
  const learnedProfileId = context.learnedProfile?.id ?? null
  const learnedProfilePromptVersion = context.learnedProfile?.promptVersion ?? null
  let draftCacheKey: string
  let estimatedPromptTokens = 0
  let businessDraftInput: Parameters<typeof generateDraftReply>[0] | null = null

  if (accountType === "personal") {
    promptVersion = "personal-draft-v1"
    const prompt = buildPersonalDraftReplyPrompt({
      personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
      messages: conversation.messages,
      conversationSummary,
      userInstruction,
      writingPreferences: context.writingPreferences,
    })
    draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)
    estimatedPromptTokens = estimateTokenCount(prompt)

    const cached = await maybeReturnCachedDraft({
      tenantId: session.user.tenantId,
      userId: session.user.id,
      conversationId: conversation.id,
      draft: conversation.draft,
      draftCacheKey,
    })
    if (cached) return cached

    try {
      const { output, model: resolvedModel } = await runAiJsonFeature<Record<string, unknown>>({
        tenantId: session.user.tenantId,
        userId: session.user.id,
        userEmail: session.user.email ?? "",
        feature: "autopilot.draft",
        messages: [{ role: "user", content: prompt }],
        schemaName: "flowdesk_draft_reply",
        schema: draftReplyJsonSchema,
        estimatedInputTokens: estimatedPromptTokens,
        estimatedOutputTokens: 500,
      })
      result = normalizeDraftReplyOutput(JSON.stringify(output), resolvedModel)
    } catch (err) {
      // Budget checks and AiUsageEvent recording (success/blocked/failed) happen
      // inside runAiJsonFeature under the "autopilot.draft" feature — recording
      // our own AiUsageEvent on top would double-count spend.
      const message = err instanceof Error ? err.message : "Failed to generate AI draft"
      const status = message.includes("spend limit reached") ? 429 : 502
      return NextResponse.json({ error: message }, { status })
    }
  } else {
    if (!context.businessProfile) {
      return NextResponse.json({ error: "Business profile is required before generating drafts" }, { status: 400 })
    }

    promptVersion = context.learnedProfile ? "business-draft-learned-v1" : "ai-draft-mvp-v1"
    knowledgeDocumentIds = context.knowledgeDocuments.map((doc) => doc.id)

    const latestJob = await prisma.agentJob.findFirst({
      where: { conversationId: conversation.id, tenantId: session.user.tenantId, status: "completed" },
      orderBy: { completedAt: "desc" },
    })
    const availableSlots = Array.isArray(latestJob?.slotsJson)
      ? (latestJob.slotsJson as string[])
      : undefined
    const draftInput = {
      aiContext: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        userEmail: session.user.email ?? "",
      },
      businessProfile: context.businessProfile,
      knowledgeDocuments: context.knowledgeDocuments,
      learnedReplyProfile: context.learnedProfile,
      messages: conversation.messages,
      conversationSummary,
      availableSlots,
      userInstruction,
      writingPreferences: context.writingPreferences,
    }
    businessDraftInput = draftInput
    const prompt = buildDraftReplyPrompt(draftInput)
    draftCacheKey = buildDraftCacheKey(promptVersion, accountType, prompt)
    estimatedPromptTokens = estimateTokenCount(prompt)

    const cached = await maybeReturnCachedDraft({
      tenantId: session.user.tenantId,
      userId: session.user.id,
      conversationId: conversation.id,
      draft: conversation.draft,
      draftCacheKey,
    })
    if (cached) return cached

    try {
      result = await generateDraftReply(draftInput)
    } catch (err) {
      // generateDraftReply -> generateDraftReplyWithOpenAI already records
      // succeeded/blocked/failed AiUsageEvents under "autopilot.draft" via
      // runAiJsonFeature — recording our own AiUsageEvent on top would
      // double-count spend.
      const message = err instanceof Error ? err.message : "Failed to generate AI draft"
      const status = message.includes("spend limit reached") ? 429 : 502
      return NextResponse.json({ error: message }, { status })
    }
  }

  let writingPreferenceFailures = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
  if (writingPreferenceFailures.length > 0) {
    try {
      if (accountType === "personal") {
        const retryPrompt = buildPersonalDraftReplyPrompt({
          personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
          messages: conversation.messages,
          conversationSummary,
          userInstruction,
          writingPreferences: context.writingPreferences,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
        const { output, model: resolvedModel } = await runAiJsonFeature<Record<string, unknown>>({
          tenantId: session.user.tenantId,
          userId: session.user.id,
          userEmail: session.user.email ?? "",
          feature: "autopilot.draft",
          messages: [{ role: "user", content: retryPrompt }],
          schemaName: "flowdesk_draft_reply",
          schema: draftReplyJsonSchema,
          estimatedInputTokens: estimateTokenCount(retryPrompt),
          estimatedOutputTokens: 500,
        })
        result = normalizeDraftReplyOutput(JSON.stringify(output), resolvedModel)
      } else if (businessDraftInput) {
        result = await generateDraftReply({
          ...businessDraftInput,
          writingPreferenceValidationFailures: writingPreferenceFailures,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to regenerate AI draft"
      return NextResponse.json({ error: message }, { status: 502 })
    }

    writingPreferenceFailures = validateDraftWritingPreferences(result.draftText, context.writingPreferences)
    if (writingPreferenceFailures.length > 0) {
      return NextResponse.json(
        {
          error: "Draft requires review because it violates writing preferences.",
          validationFailures: writingPreferenceFailures,
        },
        { status: 422 }
      )
    }
  }

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
    draftCacheKey,
    autoSendEligible: false,
    autoSendHoldReason: "manual_draft_suggestion",
    knowledgeDocumentIds,
    ...(userInstruction ? { userInstruction } : {}),
    ...(sensitiveMatches.length > 0 ? { sensitiveMatches } : {}),
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
    create: {
      conversationId: conversation.id,
      text: result.draftText,
      status: "proposed",
      metadataJson,
    },
    update: {
      text: result.draftText,
      status: "proposed",
      metadataJson,
    },
  })

  await ensureDraftApprovalRequest({
    tenantId: session.user.tenantId,
    conversationId: conversation.id,
    draftId: draft.id,
    source: "draft_suggest",
  })

  if (accountType === "business" && suggestedLabel && VALID_LABELS.includes(suggestedLabel)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        label: suggestedLabel,
        ...conversationUpdateForDraftReady(),
      },
    })
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: conversationUpdateForDraftReady(),
    })
  }

  // Push the draft into the user's Gmail so it's waiting when they open the
  // thread, and project the Autodrafted/Needs Reply labels. Best-effort: a Gmail
  // hiccup must not fail the draft suggestion the user just requested.
  if (conversation.channel.provider === "google" && conversation.externalThreadId) {
    try {
      await queueGmailDraftWriteback({
        tenantId: session.user.tenantId,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        threadId: conversation.externalThreadId,
      })
      await projectFlowDeskLabelsForConversation({
        tenantId: session.user.tenantId,
        conversationId: conversation.id,
      })
    } catch (err) {
      console.error("[draft/suggest] Gmail draft/label writeback failed:", err)
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: "draft.suggest",
      payloadJson: {
        conversationId: conversation.id,
        draftId: draft.id,
        accountType,
        metadata: metadataJson,
      },
    },
  })

  revalidateInboxViews(session.user.tenantId, conversation.id)
  return NextResponse.json({ draft, meta: metadataJson })
}

function buildDraftCacheKey(promptVersion: string, accountType: string, prompt: string): string {
  return createHash("sha256").update(`${promptVersion}\n${accountType}\n${prompt}`).digest("hex")
}

async function maybeReturnCachedDraft(input: {
  tenantId: string
  userId: string
  conversationId: string
  draft: { id: string; text: string; status: string; metadataJson?: unknown } | null
  draftCacheKey: string
}): Promise<NextResponse | null> {
  const metadata =
    input.draft?.metadataJson &&
    typeof input.draft.metadataJson === "object" &&
    !Array.isArray(input.draft.metadataJson)
      ? (input.draft.metadataJson as Record<string, unknown>)
      : null

  if (
    input.draft?.status === "proposed" &&
    input.draft.text.trim() &&
    metadata?.draftCacheKey === input.draftCacheKey
  ) {
    const meta = { ...metadata, cacheHit: true }
    await ensureDraftApprovalRequest({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      draftId: input.draft.id,
      source: "draft_suggest",
    })
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      feature: "draft.suggest.cache_hit",
      model: typeof metadata.model === "string" ? metadata.model : "none",
      status: "skipped",
    })
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: "draft.suggest.cache_hit",
        payloadJson: {
          conversationId: input.conversationId,
          draftId: input.draft.id,
        },
      },
    })
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: conversationUpdateForDraftReady(),
    })
    return NextResponse.json({ draft: input.draft, meta })
  }

  return null
}

async function parseUserInstruction(request: Request): Promise<string | null | NextResponse> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return null
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null
  }

  const value = (body as Record<string, unknown>).userInstruction
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== "string") {
    return NextResponse.json({ error: "User instruction must be text" }, { status: 400 })
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length > MAX_USER_INSTRUCTION_LENGTH) {
    return NextResponse.json({ error: "User instruction must be 500 characters or fewer" }, { status: 400 })
  }

  return trimmed
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
