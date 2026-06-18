import { prisma } from "@/lib/prisma"
import { Prisma, ConversationStatus } from "@prisma/client"

export type AutomationStep = {
  type: "create_task" | "update_attention" | "create_draft" | "archive"
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
      const updated = await prisma.conversationState.updateMany({
        where: { conversationId, tenantId },
        data: { attentionCategory, source: "automation" },
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
      await prisma.conversationState.updateMany({
        where: { conversationId: step.rollbackData.conversationId as string, tenantId },
        data: { attentionCategory: step.rollbackData.previousAttention as string },
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
