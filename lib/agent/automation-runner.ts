import { prisma } from "@/lib/prisma"
import { Prisma, ConversationStatus } from "@prisma/client"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"

// ConversationState.attentionCategory/emailType/isSalesLead/isSupport are
// denormalized *from* metadataJson (see conversation-state-metadata.ts) so
// that other code — e.g. lib/gmail-labels.ts, which projects Gmail labels
// off the dedicated column, vs. lib/agent/command-center.ts, which reads
// metadataJson.attentionCategory for the dashboard — agree on the same
// value. Writing the column alone (as this file used to for update_attention)
// silently desyncs the two: Gmail shows the new label while the in-app
// dashboard keeps showing the old one.
async function mergeAttentionIntoMetadata(
  conversationId: string,
  tenantId: string,
  attentionCategory: string
): Promise<Prisma.InputJsonValue> {
  const existing = await prisma.conversationState.findFirst({
    where: { conversationId, tenantId },
    select: { metadataJson: true },
  })
  const meta =
    existing?.metadataJson && typeof existing.metadataJson === "object" && !Array.isArray(existing.metadataJson)
      ? { ...(existing.metadataJson as Record<string, unknown>) }
      : {}
  meta.attentionCategory = attentionCategory
  return meta as Prisma.InputJsonValue
}

// "create_draft" was previously declared here but never implemented — no
// trigger, template, or builder ever constructed a step with that type, so it
// always fell through to "Unknown step type" at runtime. Draft creation is a
// separate, working system: the Gmail-native create_draft *writeback* lane
// (lib/gmail-drafts.ts + lib/agent/gmail-writeback-processor.ts), triggered
// via the draft-suggest route — unrelated to this automation-step vocabulary.
export type AutomationStep = {
  type: "create_task" | "update_attention" | "archive"
  payload: Record<string, unknown>
  status?: "pending" | "completed" | "failed"
  output?: unknown
  rollbackData?: Record<string, unknown>
}

export type StepResult = {
  status: "completed" | "failed"
  output?: unknown
  rollbackData: Record<string, unknown>
  error?: string
}

async function ensureTenantConversation(tenantId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, status: true },
  })
}

export async function executeAutomationStep(step: AutomationStep, tenantId: string): Promise<StepResult> {
  try {
    if (step.type === "create_task") {
      const { conversationId, title, deterministicKey } = step.payload as {
        tenantId: string; conversationId: string; title: string; deterministicKey: string
      }
      const conversation = await ensureTenantConversation(tenantId, conversationId)
      if (!conversation) {
        return { status: "failed", error: "Conversation not found for tenant", rollbackData: {} }
      }
      const task = await prisma.inboxTask.create({
        data: {
          tenantId, conversationId, title, deterministicKey,
          status: "open", source: "automation",
        },
      })
      await prisma.auditLog.create({
        data: {
          tenantId,
          action: "automation.create_task",
          payloadJson: { conversationId, title } as Prisma.InputJsonValue,
        },
      })
      return { status: "completed", output: { taskId: task.id }, rollbackData: { taskId: task.id } }
    }

    if (step.type === "update_attention") {
      const { conversationId, attentionCategory, previousAttention } = step.payload as {
        conversationId: string; attentionCategory: string; previousAttention: string
      }
      const conversation = await ensureTenantConversation(tenantId, conversationId)
      if (!conversation) {
        return { status: "failed", error: "Conversation not found for tenant", rollbackData: {} }
      }
      const mergedMeta = await mergeAttentionIntoMetadata(conversationId, tenantId, attentionCategory)
      const updated = await prisma.conversationState.updateMany({
        where: { conversationId, tenantId },
        data: { metadataJson: mergedMeta, source: "automation", ...conversationStateMetadataData(mergedMeta) },
      })
      if (updated.count === 0) return { status: "failed", error: "Conversation state not found", rollbackData: {} }
      await prisma.auditLog.create({
        data: {
          tenantId,
          action: "automation.update_attention",
          payloadJson: { conversationId, attentionCategory } as Prisma.InputJsonValue,
        },
      })
      return {
        status: "completed",
        output: { attentionCategory },
        rollbackData: { conversationId, previousAttention },
      }
    }

    if (step.type === "archive") {
      const { conversationId } = step.payload as { conversationId: string }
      const conv = await ensureTenantConversation(tenantId, conversationId)
      if (!conv) {
        return { status: "failed", error: "Conversation not found for tenant", rollbackData: {} }
      }
      const previousStatus = conv?.status ?? ConversationStatus.needs_reply
      await prisma.conversation.updateMany({
        where: { id: conversationId, tenantId },
        data: { status: "closed" },
      })
      await prisma.auditLog.create({
        data: {
          tenantId,
          action: "automation.archive",
          payloadJson: { conversationId } as Prisma.InputJsonValue,
        },
      })
      return { status: "completed", output: {}, rollbackData: { conversationId, previousStatus } }
    }

    return { status: "failed", error: `Unknown step type: ${step.type}`, rollbackData: {} }
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
      rollbackData: {},
    }
  }
}

export async function rollbackAutomationStep(
  step: AutomationStep & { rollbackData: Record<string, unknown> },
  tenantId: string
): Promise<void> {
  if (step.type === "create_task" && step.rollbackData.taskId) {
    await prisma.inboxTask.deleteMany({ where: { id: step.rollbackData.taskId as string, tenantId } })
  }
  if (step.type === "update_attention") {
    if (step.rollbackData.previousAttention) {
      const conversationId = step.rollbackData.conversationId as string
      const previousAttention = step.rollbackData.previousAttention as string
      const mergedMeta = await mergeAttentionIntoMetadata(conversationId, tenantId, previousAttention)
      await prisma.conversationState.updateMany({
        where: { conversationId, tenantId },
        data: { metadataJson: mergedMeta, ...conversationStateMetadataData(mergedMeta) },
      })
    } else {
      console.warn("[automation-runner] rollback skipped for update_attention: previousAttention not present", {
        conversationId: step.rollbackData.conversationId,
      })
    }
  }
  if (step.type === "archive" && step.rollbackData.conversationId) {
    await prisma.conversation.updateMany({
      where: { id: step.rollbackData.conversationId as string, tenantId },
      data: { status: (step.rollbackData.previousStatus as ConversationStatus) ?? ConversationStatus.needs_reply },
    })
  }
}

// System-default automation triggers seeded per tenant
export const DEFAULT_AUTOMATION_TRIGGERS: Array<{
  trigger: string
  name: string
  steps: AutomationStep[]
}> = [
  {
    trigger: "billing_dispute_detected",
    name: "Billing Dispute Response",
    steps: [
      { type: "update_attention", payload: { attentionCategory: "needs_action" } },
      { type: "create_task", payload: { title: "Review billing dispute", deterministicKey: "auto-billing-dispute" } },
    ],
  },
  {
    trigger: "scheduling_detected",
    name: "Scheduling Request Detected",
    steps: [
      { type: "update_attention", payload: { attentionCategory: "needs_action" } },
    ],
  },
]
