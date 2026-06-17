import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isSafeUnsubscribeUrl } from "@/lib/agent/unsubscribe"

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

  if (unsubscribeUrl && isSafeUnsubscribeUrl(unsubscribeUrl)) {
    fetch(unsubscribeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Unsubscribe attempts are best-effort; never block closing the thread.
    })
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
