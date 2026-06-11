import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const LEAD_SEQUENCE_STEPS = [
  { step: 1, name: "first_follow_up", afterDays: 2 },
  { step: 2, name: "second_follow_up", afterDays: 4 },
  { step: 3, name: "closing_follow_up", afterDays: 7 },
] as const

export type LeadSequenceStep = (typeof LEAD_SEQUENCE_STEPS)[number]

export const ACTIVE_LEAD_STAGES = ["new", "contacted", "qualified"]

const DAY_MS = 24 * 60 * 60 * 1000

export type LeadSequenceState = {
  lastStep: number
  lastStepAt: Date | null
}

export function readSequenceState(metadataJson: unknown): LeadSequenceState {
  if (metadataJson && typeof metadataJson === "object") {
    const seq = (metadataJson as Record<string, unknown>).followUpSequence
    if (seq && typeof seq === "object") {
      const record = seq as Record<string, unknown>
      const lastStep = typeof record.lastStep === "number" ? record.lastStep : 0
      const lastStepAt =
        typeof record.lastStepAt === "string" && !Number.isNaN(Date.parse(record.lastStepAt))
          ? new Date(record.lastStepAt)
          : null
      return { lastStep, lastStepAt }
    }
  }
  return { lastStep: 0, lastStepAt: null }
}

export type NextStepInput = {
  stage: string
  lastStep: number
  lastStepAt: Date | null
  lastMessageAt: Date
  lastMessageDirection: string
  now?: Date
}

export function getNextSequenceStep(input: NextStepInput): LeadSequenceStep | null {
  if (!ACTIVE_LEAD_STAGES.includes(input.stage)) return null

  // An inbound last message means the lead replied; the conversation needs a
  // reply from the user, not an automated nudge.
  if (input.lastMessageDirection === "inbound") return null

  const next = LEAD_SEQUENCE_STEPS.find((s) => s.step === input.lastStep + 1)
  if (!next) return null

  const now = input.now ?? new Date()
  const anchor =
    input.lastStepAt && input.lastStepAt.getTime() > input.lastMessageAt.getTime()
      ? input.lastStepAt
      : input.lastMessageAt

  if (now.getTime() - anchor.getTime() < next.afterDays * DAY_MS) return null

  return next
}

export type LeadSequenceBatchResult = {
  processed: number
  skipped: number
  failed: number
}

export async function runLeadSequenceBatch(tenantId?: string): Promise<LeadSequenceBatchResult> {
  const leads = await prisma.lead.findMany({
    where: {
      stage: { in: ACTIVE_LEAD_STAGES },
      ...(tenantId ? { tenantId } : {}),
    },
    include: {
      conversation: {
        select: {
          id: true,
          status: true,
          lastMessageAt: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { direction: true },
          },
        },
      },
    },
  })

  let processed = 0
  let skipped = 0
  let failed = 0

  for (const lead of leads) {
    try {
      if (lead.conversation.status === "closed") {
        skipped++
        continue
      }

      const state = readSequenceState(lead.metadataJson)
      const next = getNextSequenceStep({
        stage: lead.stage,
        lastStep: state.lastStep,
        lastStepAt: state.lastStepAt,
        lastMessageAt: lead.conversation.lastMessageAt,
        lastMessageDirection: lead.conversation.messages[0]?.direction ?? "inbound",
      })

      if (!next) {
        skipped++
        continue
      }

      const recentJob = await prisma.agentJob.findFirst({
        where: {
          conversationId: lead.conversationId,
          trigger: "lead_follow_up",
          createdAt: { gte: new Date(Date.now() - DAY_MS) },
        },
      })
      if (recentJob) {
        skipped++
        continue
      }

      await prisma.agentJob.create({
        data: {
          tenantId: lead.tenantId,
          conversationId: lead.conversationId,
          trigger: "lead_follow_up",
          slotsJson: {
            leadId: lead.id,
            step: next.step,
            stepName: next.name,
          } as Prisma.InputJsonValue,
        },
      })

      const existingMetadata =
        lead.metadataJson && typeof lead.metadataJson === "object"
          ? (lead.metadataJson as Record<string, unknown>)
          : {}

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          metadataJson: {
            ...existingMetadata,
            followUpSequence: {
              lastStep: next.step,
              lastStepAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      })

      await prisma.auditLog.create({
        data: {
          tenantId: lead.tenantId,
          action: "lead_sequence.step_queued",
          payloadJson: {
            leadId: lead.id,
            conversationId: lead.conversationId,
            step: next.step,
            stepName: next.name,
          } as Prisma.InputJsonValue,
        },
      })

      processed++
    } catch {
      failed++
    }
  }

  return { processed, skipped, failed }
}
