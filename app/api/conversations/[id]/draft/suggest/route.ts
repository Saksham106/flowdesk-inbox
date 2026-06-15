import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import OpenAI from "openai"

import { authOptions } from "@/lib/auth"
import { detectSensitiveMatches } from "@/lib/agent/risk-radar"
import { getReplyGenerationContext } from "@/lib/agent/reply-context"
import { generateDraftReply } from "@/lib/ai/provider"
import { buildPersonalDraftReplyPrompt, draftReplyJsonSchema, normalizeDraftReplyOutput } from "@/lib/ai/prompts/draft-reply"
import { summarizeConversation } from "@/lib/ai/summarize"
import { prisma } from "@/lib/prisma"

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

  if (accountType === "personal") {
    promptVersion = "personal-draft-v1"

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 })
    }

    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
    const client = new OpenAI({ apiKey })
    const prompt = buildPersonalDraftReplyPrompt({
      personalProfile: learnedProfileToPersonalStyle(context.learnedProfile),
      messages: conversation.messages,
      conversationSummary,
      userInstruction,
    })

    let rawResponse: OpenAI.Responses.Response
    try {
      rawResponse = await client.responses.create({
        model,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "flowdesk_draft_reply",
            strict: true,
            schema: draftReplyJsonSchema,
          },
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate AI draft"
      return NextResponse.json({ error: message }, { status: 502 })
    }

    result = normalizeDraftReplyOutput(rawResponse.output_text, model)
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

    try {
      result = await generateDraftReply({
        businessProfile: context.businessProfile,
        knowledgeDocuments: context.knowledgeDocuments,
        learnedReplyProfile: context.learnedProfile,
        messages: conversation.messages,
        conversationSummary,
        availableSlots,
        userInstruction,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate AI draft"
      const status = message.includes("OPENAI_API_KEY") ? 503 : 502
      return NextResponse.json({ error: message }, { status })
    }
  }

  const suggestedLabel = accountType === "business" ? result.suggestedLabel : null

  const conversationText = conversation.messages.map((m) => m.body).join("\n")
  const sensitiveMatches = detectSensitiveMatches(conversationText)

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
    ...(userInstruction ? { userInstruction } : {}),
    ...(sensitiveMatches.length > 0 ? { sensitiveMatches } : {}),
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

  if (accountType === "business" && suggestedLabel && VALID_LABELS.includes(suggestedLabel)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { label: suggestedLabel },
    })
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

  return NextResponse.json({ draft, meta: metadataJson })
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
