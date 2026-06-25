import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { AUTOMATED_SENDER_RE, AUTOMATED_BODY_RE, FYI_RE } from "@/lib/inbox-fyi"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  const candidates = await prisma.conversation.findMany({
    where: { tenantId, status: "needs_reply" },
    take: 100,
    include: {
      contact: { select: { phoneE164: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { body: true, direction: true },
      },
      stateRecord: { select: { state: true, metadataJson: true } },
    },
  })

  const toClose: string[] = []
  for (const c of candidates) {
    // Never close conversations where the user already replied
    const hasOutbound = c.messages.some((m) => m.direction === "outbound")
    if (hasOutbound) continue

    const meta = c.stateRecord?.metadataJson
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const attentionCategory = (meta as Record<string, unknown>).attentionCategory
      if (attentionCategory === "quiet" || attentionCategory === "fyi_done") {
        toClose.push(c.id)
        continue
      }
      if (typeof attentionCategory === "string") {
        continue
      }
      const emailType = (meta as Record<string, unknown>).emailType
      if (emailType === "notification" || emailType === "newsletter" || emailType === "marketing") {
        toClose.push(c.id)
        continue
      }
    }
    if (c.stateRecord?.state === "fyi_only") {
      toClose.push(c.id)
      continue
    }
    const latestInbound = c.messages.find((m) => m.direction === "inbound")
    if (!latestInbound) continue
    const email = c.contact?.phoneE164 ?? ""
    if (
      AUTOMATED_SENDER_RE.test(email) ||
      AUTOMATED_BODY_RE.test(latestInbound.body) ||
      FYI_RE.test(latestInbound.body)
    ) {
      toClose.push(c.id)
    }
  }

  if (toClose.length > 0) {
    await prisma.conversation.updateMany({
      where: { id: { in: toClose }, tenantId },
      data: { status: "closed" },
    })
  }

  return NextResponse.json({ closed: toClose.length, checked: candidates.length })
}
