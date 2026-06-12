import { prisma } from "@/lib/prisma"

const DAY_MS = 24 * 60 * 60 * 1000
const STALENESS_DAYS = 3

export type RevenueAtRiskItem = {
  conversationId: string
  contactName: string
  estimatedValue: number
  daysSinceLastMessage: number
  stage: string
}

export async function analyzeRevenueAtRisk(
  tenantId: string,
  now: Date = new Date()
): Promise<RevenueAtRiskItem[]> {
  const cutoff = new Date(now.getTime() - STALENESS_DAYS * DAY_MS)

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      estimatedValue: { gt: 0 },
      conversation: { lastMessageAt: { lt: cutoff } },
    },
    select: {
      estimatedValue: true,
      stage: true,
      conversationId: true,
      conversation: {
        select: {
          lastMessageAt: true,
          contact: { select: { name: true } },
          draft: { select: { status: true } },
        },
      },
    },
    orderBy: { estimatedValue: "desc" },
    take: 5,
  })

  return leads
    .filter(
      (l) => !l.conversation.draft || l.conversation.draft.status === "sent"
    )
    .map((l) => ({
      conversationId: l.conversationId,
      contactName: l.conversation.contact?.name ?? "Unknown",
      estimatedValue: l.estimatedValue!,
      daysSinceLastMessage: Math.floor(
        (now.getTime() - l.conversation.lastMessageAt.getTime()) / DAY_MS
      ),
      stage: l.stage,
    }))
}
