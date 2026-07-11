import { Prisma } from "@prisma/client"

import { normalizeFlowDeskLabelPayload } from "@/lib/gmail-labels"
import {
  GMAIL_DRAFT_CREATE_ACTION,
  GMAIL_DRAFT_WITHDRAW_ACTION,
  draftSourceFromMetadata,
  gmailDraftIdFromMetadata,
  latestMeaningfulInboundMessage,
} from "@/lib/gmail-drafts"
import {
  GMAIL_WRITEBACK_MAX_ATTEMPTS,
  applyFlowDeskLabelsToGmailThread,
  createGmailDraftForThread,
  deleteGmailDraft,
  markGmailThreadRead,
  nextWritebackAttemptDate,
} from "@/lib/google"
import { prisma } from "@/lib/prisma"

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

type WritebackJob = { id: string; tenantId: string; channelId: string; conversationId: string }

// What a handler reports back for the resolution audit entry: a short
// human-readable result plus any action-specific detail (labels, draft id,
// skip reason). Every job resolution — completed or permanently failed —
// becomes exactly one gmail.writeback.completed / gmail.writeback.failed
// audit row so users can trace what FlowDesk did (or failed to do) in Gmail.
type WritebackResolution = { result: string; detail?: Record<string, unknown> }

async function recordWritebackResolution(
  job: { id: string; tenantId: string; channelId: string; conversationId: string; action: string },
  outcome: "completed" | "failed",
  resolution: WritebackResolution & { error?: string; attempts?: number }
): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        tenantId: job.tenantId,
        action: `gmail.writeback.${outcome}`,
        payloadJson: {
          writebackId: job.id,
          action: job.action,
          conversationId: job.conversationId,
          channelId: job.channelId,
          result: resolution.result,
          ...(resolution.detail ?? {}),
          ...(resolution.error ? { error: resolution.error } : {}),
          ...(resolution.attempts !== undefined ? { attempts: resolution.attempts } : {}),
        } as Prisma.InputJsonValue,
      },
    })
    .catch((err) => {
      console.error("[gmail-writeback] resolution audit write failed:", err)
    })
}

// Creates (or refreshes) a Gmail-native draft for a conversation's proposed
// FlowDesk draft. Skips silently — without erroring — when there is nothing to
// draft or the user has already replied manually.
async function handleCreateDraft(job: WritebackJob): Promise<WritebackResolution> {
  const draft = await prisma.draft.findUnique({
    where: { conversationId: job.conversationId },
    include: {
      conversation: {
        select: {
          externalThreadId: true,
          channel: { select: { provider: true, emailAddress: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            select: { direction: true, providerMessageId: true, createdAt: true, body: true },
          },
        },
      },
    },
  })

  if (!draft || draft.status !== "proposed" || !draft.text.trim()) {
    return { result: "skipped", detail: { reason: "no proposed draft to write" } }
  }
  const conversation = draft.conversation
  if (conversation.channel?.provider !== "google" || !conversation.externalThreadId) {
    return { result: "skipped", detail: { reason: "not a Gmail thread" } }
  }
  const metadata = asMetadataObject(draft.metadataJson)
  const existingDraftId = gmailDraftIdFromMetadata(draft.metadataJson)
  const source = draftSourceFromMetadata(draft.metadataJson)
  const latestInbound = latestMeaningfulInboundMessage(conversation.messages)
  const latestOutbound = source
    ? conversation.messages
        .filter((message) => message.direction === "outbound")
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0]
    : undefined

  // Preserve the pre-source safety behavior for legacy draft metadata.
  if (!source && conversation.messages[0]?.direction === "outbound") {
    return { result: "skipped", detail: { reason: "user already replied manually" } }
  }

  // A synced outbound after the source draft means the user replied in Gmail.
  // The stored id is only ever set after FlowDesk creates a Gmail draft, so we
  // never delete an untracked user-created draft.
  if (source && latestOutbound && latestOutbound.createdAt > source.createdAt) {
    if (!existingDraftId) return { result: "skipped", detail: { reason: "user already replied manually" } }
    await deleteGmailDraft(job.channelId, existingDraftId)
    delete metadata.gmailDraftId
    delete metadata.gmailDraftSourceInboundMessageId
    delete metadata.gmailDraftSourceInboundAt
    await prisma.draft.update({
      where: { conversationId: job.conversationId },
      data: { metadataJson: metadata as Prisma.InputJsonValue },
    })
    return { result: "draft_withdrawn", detail: { reason: "user replied manually", gmailDraftId: existingDraftId } }
  }

  // Do not surface a response written against an earlier inbound message. The
  // next draft suggestion will carry the newer source and replace it safely.
  if (
    source &&
    latestInbound &&
    latestInbound.providerMessageId !== source.providerMessageId &&
    latestInbound.createdAt >= source.createdAt
  ) {
    if (!existingDraftId) return { result: "skipped", detail: { reason: "new inbound message requires a fresh draft" } }
    await deleteGmailDraft(job.channelId, existingDraftId)
    delete metadata.gmailDraftId
    delete metadata.gmailDraftSourceInboundMessageId
    delete metadata.gmailDraftSourceInboundAt
    await prisma.draft.update({
      where: { conversationId: job.conversationId },
      data: { metadataJson: metadata as Prisma.InputJsonValue },
    })
    return { result: "draft_invalidated", detail: { reason: "new inbound message", gmailDraftId: existingDraftId } }
  }

  const createdForSourceId = typeof metadata.gmailDraftSourceInboundMessageId === "string"
    ? metadata.gmailDraftSourceInboundMessageId
    : null
  if (existingDraftId && source && createdForSourceId === source.providerMessageId) {
    return { result: "draft_current", detail: { gmailDraftId: existingDraftId } }
  }

  // A legacy draft (or a newly suggested draft with a newer source) is
  // replaced atomically from FlowDesk's recorded id, keeping one draft/thread.
  if (existingDraftId) {
    try {
      await deleteGmailDraft(job.channelId, existingDraftId)
    } catch (err) {
      console.error("[gmail-writeback] stale draft delete failed:", err)
    }
  }

  const gmailDraftId = await createGmailDraftForThread(job.channelId, {
    externalThreadId: conversation.externalThreadId,
    channelEmail: conversation.channel.emailAddress ?? "",
    body: draft.text,
  })

  await prisma.draft.update({
    where: { conversationId: job.conversationId },
    data: {
      metadataJson: {
        ...metadata,
        gmailDraftId,
        ...(source
          ? {
              gmailDraftSourceInboundMessageId: source.providerMessageId,
              gmailDraftSourceInboundAt: source.createdAt.toISOString(),
            }
          : {}),
      } as Prisma.InputJsonValue,
    },
  })

  return {
    result: "draft_created",
    detail: { threadId: conversation.externalThreadId, gmailDraftId },
  }
}

// Deletes a previously-created Gmail-native draft and clears its recorded id.
async function handleWithdrawDraft(job: WritebackJob): Promise<WritebackResolution> {
  const draft = await prisma.draft.findUnique({
    where: { conversationId: job.conversationId },
    select: { metadataJson: true },
  })
  const gmailDraftId = draft ? gmailDraftIdFromMetadata(draft.metadataJson) : null
  if (!gmailDraftId) {
    return { result: "skipped", detail: { reason: "no Gmail draft to withdraw" } }
  }

  await deleteGmailDraft(job.channelId, gmailDraftId)

  const meta = asMetadataObject(draft?.metadataJson)
  delete meta.gmailDraftId
  await prisma.draft.update({
    where: { conversationId: job.conversationId },
    data: { metadataJson: meta as Prisma.InputJsonValue },
  })

  return { result: "draft_withdrawn", detail: { gmailDraftId } }
}

type FullWritebackJob = WritebackJob & {
  action: string
  attempts: number
  providerMessageIdsJson: unknown
}

// Processes one already-claimed job (status already flipped to "processing" by
// the caller). Shared by the cron drain and the inline best-effort drain so
// both paths record identical audit trails and retry/backoff behavior.
async function runWritebackJob(job: FullWritebackJob): Promise<{ ok: boolean }> {
  try {
    let resolution: WritebackResolution

    if (job.action === "mark_read") {
      const providerMessageIds = asStringArray(job.providerMessageIdsJson)
      await markGmailThreadRead(job.channelId, providerMessageIds, {
        tenantId: job.tenantId,
        conversationId: job.conversationId,
      })
      resolution = { result: "marked_read", detail: { messageCount: providerMessageIds.length } }
    } else if (job.action === "apply_labels") {
      const payload = normalizeFlowDeskLabelPayload(job.providerMessageIdsJson)
      if (!payload) {
        await prisma.gmailWritebackQueue.update({
          where: { id: job.id },
          data: {
            status: "failed",
            attempts: { increment: 1 },
            lastError: "Invalid FlowDesk label writeback payload",
          },
        })
        await recordWritebackResolution(job, "failed", {
          result: "invalid_payload",
          error: "Invalid FlowDesk label writeback payload",
          attempts: job.attempts + 1,
        })
        return { ok: false }
      }
      await applyFlowDeskLabelsToGmailThread(job.channelId, payload.threadId, payload.labels)
      resolution = {
        result: "labels_applied",
        detail: { threadId: payload.threadId, labels: payload.labels },
      }
    } else if (job.action === GMAIL_DRAFT_CREATE_ACTION) {
      resolution = await handleCreateDraft(job)
    } else if (job.action === GMAIL_DRAFT_WITHDRAW_ACTION) {
      resolution = await handleWithdrawDraft(job)
    } else {
      // Retrying can never make an unknown action succeed; fail it out so it
      // doesn't sit claimed (or hot-loop as pending) forever.
      await prisma.gmailWritebackQueue.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          lastError: `Unknown Gmail writeback action: ${job.action}`,
        },
      })
      await recordWritebackResolution(job, "failed", {
        result: "unknown_action",
        error: `Unknown Gmail writeback action: ${job.action}`,
        attempts: job.attempts + 1,
      })
      return { ok: false }
    }

    await prisma.gmailWritebackQueue.update({
      where: { id: job.id },
      data: { status: "completed", lastError: null },
    })
    await recordWritebackResolution(job, "completed", resolution)
    return { ok: true }
  } catch (err) {
    // Exponential backoff between retries; fail out permanently once the
    // attempt budget is spent so a broken job can't hot-loop every cron run.
    const attempts = job.attempts + 1
    const failedOut = attempts >= GMAIL_WRITEBACK_MAX_ATTEMPTS
    const message = err instanceof Error ? err.message : "Unknown Gmail writeback error"
    await prisma.gmailWritebackQueue
      .update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: message,
          status: failedOut ? "failed" : "pending",
          ...(failedOut ? {} : { nextAttemptAt: nextWritebackAttemptDate(attempts) }),
        },
      })
      .catch(() => {})
    if (failedOut) {
      await recordWritebackResolution(job, "failed", {
        result: "failed_after_retries",
        error: message,
        attempts,
      })
    }
    return { ok: false }
  }
}

// Batch drain used by the gmail-writeback cron: claims and processes up to
// `limit` pending, due jobs. Overlapping runs never double-process a job
// because the pending -> processing claim is an atomic updateMany.
export async function processPendingGmailWritebackJobs(
  limit = 25
): Promise<{ processed: number; errors: number }> {
  const jobs = await prisma.gmailWritebackQueue.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  })

  let processed = 0
  let errors = 0

  for (const job of jobs) {
    const claim = await prisma.gmailWritebackQueue.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing" },
    })
    if (claim.count !== 1) continue

    const { ok } = await runWritebackJob(job)
    if (ok) processed++
    else errors++
  }

  return { processed, errors }
}

// Best-effort inline drain of one specific job, called right after it's
// queued so a Gmail mutation lands immediately instead of waiting for the
// next cron tick. Same atomic claim as the batch path, so it's safe to race
// against an overlapping cron run — whichever claims first wins, the other
// is a no-op. On failure the job is left in its normal pending/retry state
// (or failed-out past the attempt budget) so the cron remains the backstop.
export async function processGmailWritebackJobById(jobId: string): Promise<{ ok: boolean }> {
  const claim = await prisma.gmailWritebackQueue.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "processing" },
  })
  if (claim.count !== 1) return { ok: false }

  const job = await prisma.gmailWritebackQueue.findUnique({ where: { id: jobId } })
  if (!job) return { ok: false }

  return runWritebackJob(job)
}
