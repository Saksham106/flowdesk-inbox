import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { AttentionCategory } from "@/lib/agent/email-classifier"

const VALID_CATEGORIES: AttentionCategory[] = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const conversationId = params.id
  const body = await req.json()
  const { attentionCategory } = body

  if (!VALID_CATEGORIES.includes(attentionCategory)) {
    return NextResponse.json({ error: "Invalid attentionCategory" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const existing = await prisma.conversationState.findUnique({
    where: { conversationId },
    select: { id: true, metadataJson: true },
  })

  if (!existing) {
    return NextResponse.json({ error: "No conversation state found" }, { status: 404 })
  }

  const prevMeta =
    existing.metadataJson && typeof existing.metadataJson === "object" && !Array.isArray(existing.metadataJson)
      ? (existing.metadataJson as Record<string, unknown>)
      : {}

  await prisma.conversationState.update({
    where: { conversationId },
    data: {
      metadataJson: {
        ...prevMeta,
        attentionCategory,
        attentionCorrectedByUser: true,
        attentionCorrectedAt: new Date().toISOString(),
      },
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "conversation.attention_corrected",
      payloadJson: {
        conversationId,
        attentionCategory,
        previous: typeof prevMeta.attentionCategory === "string" ? prevMeta.attentionCategory : null,
        reason: "User manually corrected attention category",
      },
    },
  })

  return NextResponse.json({ ok: true })
}
