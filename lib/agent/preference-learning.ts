import { prisma } from "@/lib/prisma"
import { extractEmail } from "@/lib/google"
import { evaluateStaticRules } from "@/lib/agent/static-rules"
import type { AttentionCategory } from "@/lib/agent/email-classifier"

const CORRECTION_THRESHOLD = 3  // corrections needed before a rule is suggested

export function extractDomainFromEmail(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().replace(/[^a-z0-9._-]/g, "") : ""
}

// Finds the sender email for a conversation by reading the first inbound message.
export async function getSenderForConversation(conversationId: string): Promise<{ fromEmail: string; fromDomain: string } | null> {
  const message = await prisma.message.findFirst({
    where: { conversationId, direction: "inbound" },
    orderBy: { createdAt: "asc" },
    select: { fromE164: true },
  })
  if (!message?.fromE164) return null
  const fromEmail = extractEmail(message.fromE164).toLowerCase()
  const fromDomain = extractDomainFromEmail(fromEmail)
  if (!fromEmail || !fromDomain) return null
  return { fromEmail, fromDomain }
}

// Records a manual attention correction and, if the same sender has been corrected
// to the same category >= CORRECTION_THRESHOLD times, upserts a suggested SenderRule.
export async function recordAttentionCorrection({
  tenantId,
  conversationId,
  previousAttention,
  newAttention,
}: {
  tenantId: string
  conversationId: string
  previousAttention: string | null
  newAttention: AttentionCategory
}): Promise<void> {
  const sender = await getSenderForConversation(conversationId)
  if (!sender) return

  const { fromEmail, fromDomain } = sender

  await prisma.classificationCorrection.create({
    data: { tenantId, conversationId, fromEmail, fromDomain, previousAttention, newAttention },
  })

  // Count how many times the user has set this exact email to this attention category
  const emailCount = await prisma.classificationCorrection.count({
    where: { tenantId, fromEmail, newAttention },
  })

  if (emailCount >= CORRECTION_THRESHOLD) {
    await prisma.senderRule.upsert({
      where: { tenantId_matchType_matchValue_targetAttention: { tenantId, matchType: "email", matchValue: fromEmail, targetAttention: newAttention } },
      create: { tenantId, matchType: "email", matchValue: fromEmail, targetAttention: newAttention, status: "suggested", triggerCount: emailCount },
      update: { triggerCount: emailCount },
    })
    return
  }

  // Fallback: check domain-level pattern (only if no email-level rule is already active/suggested)
  const domainCount = await prisma.classificationCorrection.count({
    where: { tenantId, fromDomain, newAttention },
  })

  if (domainCount >= CORRECTION_THRESHOLD) {
    await prisma.senderRule.upsert({
      where: { tenantId_matchType_matchValue_targetAttention: { tenantId, matchType: "domain", matchValue: fromDomain, targetAttention: newAttention } },
      create: { tenantId, matchType: "domain", matchValue: fromDomain, targetAttention: newAttention, status: "suggested", triggerCount: domainCount },
      update: { triggerCount: domainCount },
    })
  }
}

// Applies active AgentRules + SenderRules to a candidate attention category.
// Delegates to the shared static evaluator (lib/agent/static-rules.ts):
// AgentRule takes precedence over SenderRule, exact email match over domain.
// Callers on this path only know the sender, so rules that also require
// subject/body conditions will not match here.
// Returns the rule-determined category, or null if no active rule matches.
// This result can ONLY be overridden by a subsequent explicit user correction.
export async function applyActiveRule({
  tenantId,
  fromEmail,
}: {
  tenantId: string
  fromEmail: string
}): Promise<AttentionCategory | null> {
  const match = await evaluateStaticRules({ tenantId, fromEmail, subject: "", body: "" })
  return match?.targetAttention ?? null
}
