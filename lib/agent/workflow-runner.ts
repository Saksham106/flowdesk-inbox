import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export type WorkflowStep = {
  type: "send_draft" | "wait" | "close_conversation" | "create_task"
  waitDaysAfterPrevious?: number
  days?: number
  requireApproval?: boolean
  draftHint?: string
  taskTitle?: string
}

type WorkflowStepInput = {
  type: string
  waitDaysAfterPrevious?: number
  days?: number
  requireApproval?: boolean
  draftHint?: string
  taskTitle?: string
}

export function computeNextRunAt(step: WorkflowStepInput, from: Date): Date | null {
  const days = step.type === "wait" ? (step.days ?? 1) : (step.waitDaysAfterPrevious ?? 0)
  if (days <= 0) return null
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}

export async function advanceWorkflowStep(runId: string): Promise<"advanced" | "completed" | "skipped"> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { template: true },
  })
  if (!run || run.status !== "running") return "skipped"

  const steps = run.template.stepsJson as unknown as WorkflowStep[]
  const currentStep = run.currentStep

  if (currentStep >= steps.length) {
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "completed" } })
    await prisma.auditLog.create({
      data: {
        tenantId: run.tenantId,
        action: "workflow.completed",
        payloadJson: { runId, workflowTemplateId: run.workflowTemplateId } as Prisma.InputJsonValue,
      },
    })
    return "completed"
  }

  const step = steps[currentStep]

  if (step.type === "wait") {
    // The look-ahead from the previous step already applied this wait's delay.
    // The wait is now complete — advance past it and immediately process the next step.
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { currentStep: currentStep + 1 },
    })
    return advanceWorkflowStep(runId)
  }

  if (step.type === "close_conversation") {
    await prisma.conversation.update({
      where: { id: run.conversationId },
      data: { status: "closed" },
    })
    await prisma.auditLog.create({
      data: {
        tenantId: run.tenantId,
        action: "workflow.close_conversation",
        payloadJson: { runId, conversationId: run.conversationId } as Prisma.InputJsonValue,
      },
    })
  }

  if (step.type === "create_task" && step.taskTitle) {
    await prisma.inboxTask.create({
      data: {
        tenantId: run.tenantId,
        conversationId: run.conversationId,
        title: step.taskTitle,
        status: "open",
        source: "workflow",
        deterministicKey: `workflow-${run.id}-step-${currentStep}`,
      },
    })
    await prisma.auditLog.create({
      data: {
        tenantId: run.tenantId,
        action: "workflow.create_task",
        payloadJson: { runId, conversationId: run.conversationId, taskTitle: step.taskTitle } as Prisma.InputJsonValue,
      },
    })
  }

  const nextStep = steps[currentStep + 1]
  const nextRunAt = nextStep ? computeNextRunAt(nextStep, new Date()) : null

  if (currentStep + 1 >= steps.length) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "completed", currentStep: currentStep + 1 },
    })
    await prisma.auditLog.create({
      data: {
        tenantId: run.tenantId,
        action: "workflow.completed",
        payloadJson: { runId, workflowTemplateId: run.workflowTemplateId } as Prisma.InputJsonValue,
      },
    })
    return "completed"
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { currentStep: currentStep + 1, nextRunAt },
  })
  return "advanced"
}

export async function runDueWorkflows(): Promise<number> {
  const due = await prisma.workflowRun.findMany({
    where: { status: "running", nextRunAt: { lte: new Date() } },
    take: 50,
  })
  let count = 0
  for (const run of due) {
    await advanceWorkflowStep(run.id)
    count++
  }
  return count
}
