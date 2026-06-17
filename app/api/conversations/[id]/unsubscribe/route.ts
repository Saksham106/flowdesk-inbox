import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const state = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  })
  const meta =
    state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
      ? (state.metadataJson as Record<string, unknown>)
      : {}
  const unsubscribeUrl = typeof meta.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null

  if (unsubscribeUrl) {
    // Fire-and-forget GET request to unsubscribe URL
    fetch(unsubscribeUrl, { method: "GET" }).catch(() => {/* ignore errors */})
  }

  // Close the conversation and log
  await prisma.conversation.update({
    where: { id: params.id },
    data: { status: "closed" },
  })
  await prisma.auditLog.create({
    data: {
      tenantId: conversation.tenantId,
      action: "conversation.unsubscribed",
      payloadJson: { conversationId: params.id, unsubscribeUrl },
    },
  })

  return NextResponse.json({ ok: true })
}
