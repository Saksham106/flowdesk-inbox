import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { scoreLead } from "@/lib/ai/provider"
import { buildLeadScoringPrompt, type LeadScoringPromptInput } from "@/lib/ai/prompts/lead-scoring"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"

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

  const input: LeadScoringPromptInput = {
    messages: lead.conversation.messages.slice().reverse(),
    existingNeed: lead.need,
    existingUrgency: lead.urgency,
    existingBudgetClue: lead.budgetClue,
  }
  const prompt = buildLeadScoringPrompt(input)
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const estimatedInputTokens = estimateTokenCount(prompt)
  const budgetCheck = await checkAiBudgetForTokens({
    tenantId,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: 500,
  })
  if (!budgetCheck.allowed) {
    await recordAiUsageEvent({
      tenantId,
      feature: "lead.score",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    return
  }

  let result: Awaited<ReturnType<typeof scoreLead>>
  try {
    result = await scoreLead(input)
  } catch {
    await recordAiUsageEvent({
      tenantId,
      feature: "lead.score",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    // Leave existing heuristic score intact on LLM failure
    return
  }

  await recordAiUsageEvent({
    tenantId,
    feature: "lead.score",
    model: result.model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

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
