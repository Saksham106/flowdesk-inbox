import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { scoreLead } from "@/lib/ai/provider"
import type { LeadScoringPromptInput } from "@/lib/ai/prompts/lead-scoring"

export function shouldRescoreLead(
  scoredAt: Date | null,
  conversationLastMessageAt: Date
): boolean {
  if (!scoredAt) return true
  return conversationLastMessageAt > scoredAt
}

export async function scoreLeadForConversation(
  tenantId: string,
  leadId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 20 },
        },
      },
    },
  })

  if (!lead || !lead.conversation) return

  if (!options.force && !shouldRescoreLead(lead.scoredAt, lead.conversation.lastMessageAt)) return

  const input: LeadScoringPromptInput = {
    messages: lead.conversation.messages,
    existingNeed: lead.need,
    existingUrgency: lead.urgency,
    existingBudgetClue: lead.budgetClue,
  }

  let result: Awaited<ReturnType<typeof scoreLead>>
  try {
    result = await scoreLead(input)
  } catch {
    // Leave existing heuristic score intact on LLM failure
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      score: result.score,
      scoreExplanation: result.scoreExplanation,
      estimatedValue: result.estimatedValue,
      scoredAt: new Date(),
      need: result.need,
      urgency: result.urgency,
      budgetClue: result.budgetClue ?? lead.budgetClue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "lead.scored",
      payloadJson: {
        leadId,
        score: result.score,
        source: "llm",
        model: result.model,
      } as Prisma.InputJsonValue,
    },
  })
}
