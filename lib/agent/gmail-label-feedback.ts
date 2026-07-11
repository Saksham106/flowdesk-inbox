import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { hasGmailLabelOverride } from "@/lib/agent/gmail-label-override"
import { applyLabelFeedbackCore } from "@/lib/agent/label-feedback-core"

export { hasGmailLabelOverride } from "@/lib/agent/gmail-label-override"

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Removes a Gmail-label hold after a genuinely new inbound message resets the thread context. */
export async function clearGmailLabelOverride(input: {
  tenantId: string
  conversationId: string
}): Promise<boolean> {
  const state = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { metadataJson: true },
  })
  if (!state || !hasGmailLabelOverride(state.metadataJson)) return false

  const metadataJson = metadataRecord(state.metadataJson)
  delete metadataJson.gmailLabelOverride
  await prisma.conversationState.update({
    where: { conversationId: input.conversationId },
    data: { metadataJson: metadataJson as Prisma.InputJsonValue },
  })
  return true
}

/**
 * Gmail-provider entry point for mailbox-label feedback learning. A thin wrapper
 * over the provider-neutral core; keeps its exact exported signature so existing
 * Gmail sync/webhook callers are unaffected.
 */
export async function applyGmailLabelFeedback(input: {
  tenantId: string
  conversationId: string
  added: string[]
  removed: string[]
}): Promise<{ applied: boolean; kind: "addition" | "removal" | "ignored" }> {
  return applyLabelFeedbackCore({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    added: input.added,
    removed: input.removed,
    auditAction: "gmail.labels.corrected",
  })
}
