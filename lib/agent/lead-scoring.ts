import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { scoreLead } from "@/lib/ai/provider"
import { buildLeadScoringPrompt, type LeadScoringPromptInput } from "@/lib/ai/prompts/lead-scoring"
import { recordAiUsageEvent } from "@/lib/ai/usage"

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
          messages: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      },
    },
  })

  if (!lead || !lead.conversation) return

  if (!options.force && !shouldRescoreLead(lead.scoredAt, lead.conversation.lastMessageAt)) return

  // Background job, no session user in scope — resolve the tenant's earliest
  // user as the owner for OpenRouter key + budget attribution. Leave the
  // heuristic score intact if the tenant somehow has no user, but record an
  // observable AiUsageEvent so the skip isn't silent (mirrors the no-owner
  // fallback in lib/agent/person-memory.ts).
  const owner = await prisma.user.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  })
  if (!owner) {
    await recordAiUsageEvent({
      tenantId,
      feature: "lead.score",
      model: "none",
      status: "skipped",
      errorMessage: "No tenant owner found for lead scoring",
    })
    return
  }

  const input: LeadScoringPromptInput = {
    aiContext: { tenantId, userId: owner.id, userEmail: owner.email },
    messages: lead.conversation.messages.slice().reverse(),
    existingNeed: lead.need,
    existingUrgency: lead.urgency,
    existingBudgetClue: lead.budgetClue,
  }

  // Budget checks and AiUsageEvent recording happen inside runAiJsonFeature
  // (via scoreLead -> scoreLeadWithOpenAI), keyed by the "lead.score" feature.
  let result: Awaited<ReturnType<typeof scoreLead>>
  try {
    result = await scoreLead(input)
  } catch {
    // Leave existing heuristic score intact on LLM failure
    return
  }

  await prisma.lead.updateMany({
    where: { id: leadId, tenantId },
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
