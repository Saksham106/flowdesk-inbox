import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { proposeDraftForConversation } from "@/lib/agent/draft-generation"
import { getAutomationLevel } from "@/lib/agent/automation-level"

export const runtime = "nodejs"

const HARD_CAP = 50

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (await getAutomationLevel(session.user.tenantId) < 3) {
    return NextResponse.json({ error: "Draft backfill requires automation level 3 or higher" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const scope = (body as Record<string, unknown>).scope
  const n = (body as Record<string, unknown>).n

  if (scope !== "all" && scope !== "last_n") {
    return NextResponse.json({ error: "scope must be \"all\" or \"last_n\"" }, { status: 400 })
  }

  const take = scope === "last_n" ? Math.min(typeof n === "number" ? n : 10, HARD_CAP) : HARD_CAP

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: session.user.tenantId, status: "needs_reply", draft: null },
    orderBy: { lastMessageAt: "desc" },
    take,
    select: { id: true },
  })

  const results: Array<{ conversationId: string; status: string }> = []
  for (const conversation of conversations) {
    const result = await proposeDraftForConversation({
      tenantId: session.user.tenantId,
      conversationId: conversation.id,
      userId: session.user.id,
      userEmail: session.user.email ?? "",
      source: "backfill",
    })
    results.push({ conversationId: conversation.id, status: result.status })
  }

  return NextResponse.json({ results })
}
