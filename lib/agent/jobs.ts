import { prisma } from "@/lib/prisma"
import { getFullBusinessContext } from "@/lib/agent/context"
import { classifyConversation } from "@/lib/agent/classify"
import { checkPolicy } from "@/lib/agent/policy"
import { checkAvailability, formatSlots, type AvailableSlot } from "@/lib/agent/availability"
import { attemptAutopilotSend } from "@/lib/agent/autopilot"
import type { AgentJob, Prisma } from "@prisma/client"
import type { ClassifyResult } from "@/lib/ai/prompts/classify"

const SCHEDULING_KEYWORDS = /book|appointment|schedul|reschedul|availab|slot|time|when|visit/i

function isSchedulingIntent(intent: string, suggestedLabel: string | null): boolean {
  return SCHEDULING_KEYWORDS.test(intent) || suggestedLabel === "Reschedule"
}

export type CreateAgentJobInput = {
  tenantId: string
  conversationId: string
  trigger: string
}

export type AgentJobResult =
  | { status: "completed"; intent: string; confidence: number; requiresApproval: boolean; autopilotSent?: boolean }
  | { status: "failed"; error: string }

export async function createAgentJob(input: CreateAgentJobInput): Promise<AgentJob> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
  })

  if (!conversation) {
    throw new Error("Conversation not found or does not belong to this tenant")
  }

  return prisma.agentJob.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      trigger: input.trigger,
    },
  })
}

export async function runAgentJob(jobId: string): Promise<AgentJobResult> {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } })
  if (!job) {
    return { status: "failed", error: "Job not found" }
  }

  await prisma.agentJob.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date() },
  })

  try {
    const result = await _executeJob(job)

    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        completedAt: new Date(),
        intent: result.intent,
        confidence: result.confidence,
        requiresApproval: result.requiresApproval,
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "agent_job.completed",
        payloadJson: {
          jobId,
          conversationId: job.conversationId,
          trigger: job.trigger,
          intent: result.intent,
          confidence: result.confidence,
          requiresApproval: result.requiresApproval,
        },
      },
    })

    // Attempt autopilot send if policy and settings allow it (best-effort)
    let autopilotSent = false
    try {
      const autopilotResult = await attemptAutopilotSend(
        jobId,
        result.classification,
        { requiresApproval: result.policyRequiresApproval, escalate: result.policyRequiresApproval, reason: null }
      )
      autopilotSent = autopilotResult.sent
    } catch {
      // autopilot errors never fail the job itself
    }

    return { status: "completed", intent: result.intent, confidence: result.confidence, requiresApproval: result.requiresApproval, autopilotSent }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error"

    await prisma.agentJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date(), error },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: job.tenantId,
        action: "agent_job.failed",
        payloadJson: { jobId, conversationId: job.conversationId, error },
      },
    })

    return { status: "failed", error }
  }
}

async function _executeJob(
  job: AgentJob
): Promise<{ intent: string; confidence: number; requiresApproval: boolean; classification: ClassifyResult; policyRequiresApproval: boolean }> {
  const [conversation, businessContext] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: job.conversationId, tenantId: job.tenantId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    getFullBusinessContext(job.tenantId),
  ])

  if (!conversation) {
    throw new Error("Conversation not found during job execution")
  }

  const classifyToolCall = await prisma.agentToolCall.create({
    data: {
      agentJobId: job.id,
      toolName: "classifyConversation",
      inputJson: {
        conversationId: conversation.id,
        messageCount: conversation.messages.length,
      },
    },
  })

  let classification
  try {
    classification = await classifyConversation({
      messages: conversation.messages,
      businessProfile: businessContext.profile,
    })

    await prisma.agentToolCall.update({
      where: { id: classifyToolCall.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        outputJson: classification as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    await prisma.agentToolCall.update({
      where: { id: classifyToolCall.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        outputJson: { error: err instanceof Error ? err.message : "Unknown error" },
      },
    })
    throw err
  }

  const policy = checkPolicy(classification)

  await _maybeCheckAvailability(job, classification, businessContext.profile)

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    requiresApproval: policy.requiresApproval,
    classification,
    policyRequiresApproval: policy.requiresApproval,
  }
}

async function _maybeCheckAvailability(
  job: AgentJob,
  classification: { intent: string; suggestedLabel: string | null },
  profile: { primaryCalendarEmail?: string | null; serviceDurationMinutes?: number; timezone?: string | null; businessHoursJson?: unknown } | null
): Promise<void> {
  const calendarEmail = profile?.primaryCalendarEmail
  if (!calendarEmail || !isSchedulingIntent(classification.intent, classification.suggestedLabel)) {
    return
  }

  const availToolCall = await prisma.agentToolCall.create({
    data: {
      agentJobId: job.id,
      toolName: "checkAvailability",
      inputJson: {
        calendarEmail,
        durationMinutes: profile?.serviceDurationMinutes ?? 60,
      },
    },
  })

  try {
    const slots: AvailableSlot[] = await checkAvailability(job.tenantId, calendarEmail, {
      durationMinutes: profile?.serviceDurationMinutes ?? 60,
      timezone: profile?.timezone ?? "America/New_York",
      businessHoursJson: profile?.businessHoursJson,
    })

    const formatted = formatSlots(slots, profile?.timezone ?? "America/New_York")

    await prisma.agentToolCall.update({
      where: { id: availToolCall.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        outputJson: { slots: formatted } as unknown as Prisma.InputJsonValue,
      },
    })

    await prisma.agentJob.update({
      where: { id: job.id },
      data: { slotsJson: formatted as unknown as Prisma.InputJsonValue },
    })
  } catch (err) {
    await prisma.agentToolCall.update({
      where: { id: availToolCall.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        outputJson: { error: err instanceof Error ? err.message : "Unknown error" } as unknown as Prisma.InputJsonValue,
      },
    }).catch(() => {})
  }
}
