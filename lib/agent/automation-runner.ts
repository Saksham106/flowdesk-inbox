import { prisma } from "@/lib/prisma"

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

export async function executeAutomationStep(step: AutomationStep): Promise<StepResult> {
  try {
    if (step.type === "create_task") {
      const { tenantId, conversationId, title, deterministicKey } = step.payload as {
        tenantId: string; conversationId: string; title: string; deterministicKey: string
      }
      const task = await prisma.inboxTask.create({
        data: {
          tenantId, conversationId, title, deterministicKey,
          status: "open", source: "automation",
        },
      })
      return { status: "completed", output: { taskId: task.id }, rollbackData: { taskId: task.id } }
    }

    if (step.type === "update_attention") {
      const { conversationId, attentionCategory } = step.payload as {
        conversationId: string; attentionCategory: string; previousAttention?: string
      }
      await prisma.conversationState.update({
        where: { conversationId },
        data: { attentionCategory, source: "automation" },
      })
      return {
        status: "completed",
        output: { attentionCategory },
        rollbackData: { conversationId, previousAttention: step.payload.previousAttention ?? null },
      }
    }

    if (step.type === "archive") {
      const { conversationId } = step.payload as { conversationId: string }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "closed" },
      })
      return { status: "completed", output: {}, rollbackData: { conversationId } }
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

export async function rollbackAutomationStep(step: AutomationStep & { rollbackData: Record<string, unknown> }): Promise<void> {
  if (step.type === "create_task" && step.rollbackData.taskId) {
    await prisma.inboxTask.deleteMany({ where: { id: step.rollbackData.taskId as string } })
  }
  if (step.type === "update_attention" && step.rollbackData.previousAttention) {
    await prisma.conversationState.update({
      where: { conversationId: step.rollbackData.conversationId as string },
      data: { attentionCategory: step.rollbackData.previousAttention as string },
    })
  }
  if (step.type === "archive" && step.rollbackData.conversationId) {
    await prisma.conversation.update({
      where: { id: step.rollbackData.conversationId as string },
      data: { status: "needs_reply" },
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
