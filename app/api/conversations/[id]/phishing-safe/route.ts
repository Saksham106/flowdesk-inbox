import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

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
    select: { id: true },
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

  await prisma.conversationState.update({
    where: { conversationId: params.id },
    data: {
      metadataJson: {
        ...meta,
        phishingMarkedSafe: true,
        phishingVerdict: null,
      } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true })
}
