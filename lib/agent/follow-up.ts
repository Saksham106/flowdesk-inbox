import { prisma } from "@/lib/prisma"
import { projectFlowDeskLabelsForConversation } from "@/lib/email-labels"
import { DEFAULT_FOLLOW_UP_BUSINESS_DAYS, followUpDueAt } from "@/lib/business-days"
import type { MessageDirection, Prisma } from "@prisma/client"

export type StaleConversation = {
  id: string
  tenantId: string
  externalThreadId: string
  lastMessageAt: Date
  status: string
  label: string | null
  lastMessageDirection: MessageDirection
}

export async function getStaleConversations(
  tenantId: string,
  staleAfterDays: number
): Promise<StaleConversation[]> {
  const threshold = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000)

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
      lastMessageAt: { lt: threshold },
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 200,
  })

  return conversations.map((conv) => ({
    id: conv.id,
    tenantId: conv.tenantId,
    externalThreadId: conv.externalThreadId,
    lastMessageAt: conv.lastMessageAt,
    status: conv.status,
    label: conv.label,
    lastMessageDirection: conv.messages[0]?.direction ?? "inbound",
  }))
}

// ─── Waiting-on lifecycle ────────────────────────────────────────────────────
// Deterministic detection of "this outbound reply expects a response", shared by
// the FlowDesk send path and the Gmail sync path (replies sent directly in
// Gmail). No LLM involvement; mode-agnostic (personal and business tenants get
// the same lifecycle).

const QUOTED_LINE = /^\s*(>|On .+ wrote:)/

const EXPECTS_REPLY_PATTERNS: RegExp[] = [
  /\?/,
  /\blet (me|us) know\b/i,
  /\bplease\s+(confirm|advise|reply|respond|send|share|review|sign|approve)\b/i,
  /\b(can|could|would|will)\s+you\b/i,
  /\bget back to (me|us)\b/i,
  /\blook(ing)? forward to (hearing|your)\b/i,
  /\bwhen you (get|have) a (chance|moment|minute|sec)\b/i,
  /\bawait(ing)?\s+(your|the)\b/i,
  /\bany\s+(update|updates|thoughts|feedback)\b/i,
  /\bkeep (me|us) (posted|updated|in the loop)\b/i,
]

/**
 * Does an outbound message plausibly expect a response? Quoted/reply-header
 * lines are stripped first so text quoted from the other side can't trigger it.
 */
export function outboundMessageExpectsReply(body: string): boolean {
  const ownText = body
    .split(/\r?\n/)
    .filter((line) => !QUOTED_LINE.test(line))
    .join("\n")
  return EXPECTS_REPLY_PATTERNS.some((pattern) => pattern.test(ownText))
}

export const WAITING_ON_STATE_SOURCE = "flowdesk_lifecycle"

// Pure business-day math lives in lib/business-days.ts (shared with UI
// components); re-exported here so lifecycle callers have one import surface.
export {
  DEFAULT_FOLLOW_UP_BUSINESS_DAYS,
  addBusinessDays,
  followUpDueAt,
} from "@/lib/business-days"

/**
 * Transitions a conversation into waiting-on after an outbound reply that
 * expects a response was detected via sync (i.e. sent directly in Gmail, not
 * through FlowDesk — the send routes make their own transition). Only touches
 * `status`; `userState` stays untouched so an explicit user choice still wins.
 */
export async function markConversationWaitingOn(input: {
  tenantId: string
  conversationId: string
  detectedFrom: string
}): Promise<void> {
  await prisma.conversation.update({
    where: { id: input.conversationId, tenantId: input.tenantId },
    // deriveWorkflowStatus maps in_progress → waiting_on
    data: { status: "in_progress" },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "conversation.waiting_on_detected",
      payloadJson: {
        conversationId: input.conversationId,
        detectedFrom: input.detectedFrom,
        source: WAITING_ON_STATE_SOURCE,
      },
    },
  })
}

/**
 * Self-healing on reply: an inbound message arrived on a waiting-on
 * conversation, so waiting is over. Moves it back to needs_reply (clearing an
 * explicit waiting_on userState — the reply supersedes it), cancels any
 * scheduled follow-up jobs, and audits the transition. Label re-projection is
 * the caller's responsibility (work-item-sync runs it right after).
 */
export async function clearWaitingOnForInboundReply(input: {
  tenantId: string
  conversationId: string
}): Promise<void> {
  const now = new Date()

  await prisma.conversation.update({
    where: { id: input.conversationId, tenantId: input.tenantId },
    data: {
      userState: null,
      userStateSource: WAITING_ON_STATE_SOURCE,
      userStateUpdatedAt: now,
      status: "needs_reply",
    },
  })

  // A stale waiting_on attention category would re-derive "Waiting On" at the
  // next label projection, so rewrite it (column + its metadataJson mirror).
  const state = await prisma.conversationState.findUnique({
    where: { conversationId: input.conversationId },
    select: { attentionCategory: true, metadataJson: true },
  })
  if (state?.attentionCategory === "waiting_on") {
    const meta =
      state.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
        ? { ...(state.metadataJson as Record<string, unknown>) }
        : {}
    meta.attentionCategory = "needs_reply"
    await prisma.conversationState.update({
      where: { conversationId: input.conversationId },
      data: {
        attentionCategory: "needs_reply",
        metadataJson: meta as Prisma.InputJsonValue,
      },
    })
  }

  // A reply arrived — any scheduled follow-up nudge for this thread is moot.
  const cancelled = await prisma.agentJob.updateMany({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      trigger: "follow_up",
      status: "pending",
    },
    data: { status: "failed", error: "cancelled_by_inbound_reply", completedAt: now },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: "conversation.waiting_on_cleared",
      payloadJson: {
        conversationId: input.conversationId,
        reason: "inbound_reply",
        cancelledFollowUpJobs: cancelled.count,
      },
    },
  })
}

export async function hasRecentFollowUpJob(
  conversationId: string,
  withinHours = 24
): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)
  const job = await prisma.agentJob.findFirst({
    where: {
      conversationId,
      trigger: "follow_up",
      createdAt: { gte: since },
    },
  })
  return !!job
}

export async function countFollowUpJobs(conversationId: string): Promise<number> {
  return prisma.agentJob.count({
    where: { conversationId, trigger: "follow_up" },
  })
}

export type FollowUpLabelSweepResult = {
  projected: number
  skipped: number
  failed: number
}

/**
 * Re-projects Gmail labels for overdue waiting-on conversations. There is no
 * distinct "Follow Up" Gmail label anymore — overdue tracking is app-only
 * (see followUpDueAt / WaitingOnSection) — but nothing else triggers a label
 * projection purely from time passing, so this sweep still catches drift
 * (e.g. a conversation whose classification or workflow status changed
 * without a corresponding re-projection).
 *
 * Runs for every tenant — deliberately NOT gated on FollowUpSetting.enabled,
 * which only opts a tenant into automated follow-up *jobs* (draft nudges).
 * Labels + surfacing are part of the base lifecycle for personal and business
 * accounts alike. No auto-send here.
 */
export async function runFollowUpLabelSweep(now = new Date()): Promise<FollowUpLabelSweepResult> {
  // Coarse prefilter: the smallest configurable delay is 1 business day, so
  // anything younger than 24h can't be due. Precise per-tenant check below.
  const coarseCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const candidates = await prisma.conversation.findMany({
    where: {
      OR: [{ status: "in_progress" }, { userState: "waiting_on" }],
      lastMessageAt: { lt: coarseCutoff },
      externalThreadId: { not: "" },
      channel: { provider: "google" },
    },
    select: { id: true, tenantId: true, lastMessageAt: true },
    orderBy: { lastMessageAt: "asc" },
    take: 200,
  })

  if (candidates.length === 0) return { projected: 0, skipped: 0, failed: 0 }

  const settings = await prisma.followUpSetting.findMany({
    where: { tenantId: { in: Array.from(new Set(candidates.map((c) => c.tenantId))) } },
    select: { tenantId: true, staleAfterDays: true },
  })
  const staleDaysByTenant = new Map(settings.map((s) => [s.tenantId, s.staleAfterDays]))

  // Skip conversations already re-projected recently — re-queuing them every
  // cron run would spam Gmail with redundant no-op writebacks. "Recently"
  // matches the sweep's own cadence (coarseCutoff, 24h).
  const queuedRows = await prisma.emailWritebackQueue.findMany({
    where: {
      conversationId: { in: candidates.map((c) => c.id) },
      action: "apply_labels",
      status: { not: "failed" },
      updatedAt: { gte: coarseCutoff },
    },
    select: { conversationId: true },
  })
  const alreadyQueued = new Set(queuedRows.map((row) => row.conversationId))

  let projected = 0
  let skipped = 0
  let failed = 0

  for (const conv of candidates) {
    const staleDays = staleDaysByTenant.get(conv.tenantId) ?? DEFAULT_FOLLOW_UP_BUSINESS_DAYS
    if (now < followUpDueAt(conv.lastMessageAt, staleDays) || alreadyQueued.has(conv.id)) {
      skipped++
      continue
    }

    try {
      const job = await projectFlowDeskLabelsForConversation({
        tenantId: conv.tenantId,
        conversationId: conv.id,
      })
      if (!job) {
        skipped++
        continue
      }
      await prisma.auditLog.create({
        data: {
          tenantId: conv.tenantId,
          action: "follow_up.due_labeled",
          payloadJson: {
            conversationId: conv.id,
            waitingSince: conv.lastMessageAt.toISOString(),
            staleAfterBusinessDays: staleDays,
          },
        },
      })
      projected++
    } catch {
      failed++
    }
  }

  return { projected, skipped, failed }
}

export type FollowUpBatchResult = {
  processed: number
  skipped: number
  failed: number
}

export async function runFollowUpBatch(tenantId?: string): Promise<FollowUpBatchResult> {
  const settings = await prisma.followUpSetting.findMany({
    where: {
      enabled: true,
      ...(tenantId ? { tenantId } : {}),
    },
  })

  let processed = 0
  let skipped = 0
  let failed = 0

  for (const setting of settings) {
    const conversations = await getStaleConversations(setting.tenantId, setting.staleAfterDays)

    for (const conv of conversations) {
      try {
        const alreadyQueued = await hasRecentFollowUpJob(conv.id)
        if (alreadyQueued) {
          skipped++
          continue
        }

        const totalFollowUps = await countFollowUpJobs(conv.id)
        if (totalFollowUps >= setting.maxFollowUpsPerConversation) {
          skipped++
          continue
        }

        await prisma.agentJob.create({
          data: {
            tenantId: setting.tenantId,
            conversationId: conv.id,
            trigger: "follow_up",
          },
        })

        await prisma.auditLog.create({
          data: {
            tenantId: setting.tenantId,
            action: "follow_up.job_created",
            payloadJson: {
              conversationId: conv.id,
              lastMessageAt: conv.lastMessageAt.toISOString(),
              staleAfterDays: setting.staleAfterDays,
            },
          },
        })

        processed++
      } catch {
        failed++
      }
    }
  }

  return { processed, skipped, failed }
}
