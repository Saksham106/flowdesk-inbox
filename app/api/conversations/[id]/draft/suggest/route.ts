import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { getFullBusinessContext } from "@/lib/agent/context"
import { generateDraftReply } from "@/lib/ai/provider"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const VALID_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const

export async function POST(
  _request: Request,
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

  const context = await getFullBusinessContext(session.user.tenantId)
  if (!context.profile) {
    return NextResponse.json({ error: "Business profile is required before generating drafts" }, { status: 400 })
  }

  const latestJob = await prisma.agentJob.findFirst({
    where: { conversationId: conversation.id, tenantId: session.user.tenantId, status: "completed" },
    orderBy: { completedAt: "desc" },
  })
  const availableSlots = Array.isArray(latestJob?.slotsJson)
    ? (latestJob.slotsJson as string[])
    : undefined

  let result: Awaited<ReturnType<typeof generateDraftReply>>
  try {
    result = await generateDraftReply({
      businessProfile: context.profile,
      knowledgeDocuments: context.documents,
      messages: conversation.messages,
      availableSlots,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate AI draft"
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502
    return NextResponse.json({ error: message }, { status })
  }

  const metadataJson = {
    intent: result.intent,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    suggestedLabel: result.suggestedLabel,
    escalationReason: result.escalationReason,
    model: result.model,
    promptVersion: "ai-draft-mvp-v1",
    knowledgeDocumentIds: context.documents.map((doc) => doc.id),
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

  if (result.suggestedLabel && VALID_LABELS.includes(result.suggestedLabel)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { label: result.suggestedLabel },
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
        metadata: metadataJson,
      },
    },
  })

  return NextResponse.json({ draft, meta: metadataJson })
}
