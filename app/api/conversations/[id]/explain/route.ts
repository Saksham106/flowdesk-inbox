import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { explainThread } from "@/lib/ai/provider"
import { buildExplainThreadPrompt } from "@/lib/ai/prompts/explain-thread"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

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
      contact: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 40,
      },
    },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  if (conversation.messages.length === 0) {
    return NextResponse.json({ error: "Conversation has no messages to explain" }, { status: 400 })
  }

  const input = {
    contactName: conversation.contact?.name ?? null,
    conversationStatus: conversation.status,
    messages: conversation.messages,
  }

  let result: Awaited<ReturnType<typeof explainThread>>
  try {
    result = await explainThread(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to explain thread"
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502
    await recordAiUsageEvent({
      tenantId: session.user.tenantId,
      feature: "explain_thread",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      status: "failed",
    })
    return NextResponse.json({ error: message }, { status })
  }

  await recordAiUsageEvent({
    tenantId: session.user.tenantId,
    feature: "explain_thread",
    model: result.model,
    estimatedInputTokens: estimateTokenCount(buildExplainThreadPrompt(input)),
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      action: "conversation.explained",
      payloadJson: {
        conversationId: conversation.id,
        riskLevel: result.riskLevel,
        actionCount: result.whatYouNeedToDo.length,
        riskCount: result.risks.length,
        model: result.model,
      },
    },
  })

  return NextResponse.json({ explanation: result })
}
