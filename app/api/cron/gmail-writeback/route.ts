import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { normalizeFlowDeskLabelPayload } from "@/lib/gmail-labels"
import {
  GMAIL_DRAFT_CREATE_ACTION,
  GMAIL_DRAFT_WITHDRAW_ACTION,
  gmailDraftIdFromMetadata,
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

export const runtime = "nodejs"

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

type WritebackJob = { id: string; tenantId: string; channelId: string; conversationId: string }

// Creates (or refreshes) a Gmail-native draft for a conversation's proposed
// FlowDesk draft. Skips silently — without erroring — when there is nothing to
// draft or the user has already replied manually.
async function handleCreateDraft(job: WritebackJob): Promise<void> {
  const draft = await prisma.draft.findUnique({
    where: { conversationId: job.conversationId },
    include: {
      conversation: {
        select: {
          externalThreadId: true,
          channel: { select: { provider: true, emailAddress: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { direction: true },
          },
        },
      },
    },
  })

  if (!draft || draft.status !== "proposed" || !draft.text.trim()) return
  const conversation = draft.conversation
  if (conversation.channel?.provider !== "google" || !conversation.externalThreadId) return
  // Manual-reply detection: the latest message being outbound means the user
  // already replied, so a waiting draft would be noise — don't create one.
  if (conversation.messages[0]?.direction === "outbound") return

  // Dedup: remove any prior Gmail draft before creating a fresh one so the
  // content stays current and we never leave duplicates behind.
  const existingDraftId = gmailDraftIdFromMetadata(draft.metadataJson)
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
        ...asMetadataObject(draft.metadataJson),
        gmailDraftId,
      } as Prisma.InputJsonValue,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: job.tenantId,
      action: "gmail.draft.created",
      payloadJson: { conversationId: job.conversationId, channelId: job.channelId, gmailDraftId },
    },
  })
}

// Deletes a previously-created Gmail-native draft and clears its recorded id.
async function handleWithdrawDraft(job: WritebackJob): Promise<void> {
  const draft = await prisma.draft.findUnique({
    where: { conversationId: job.conversationId },
    select: { metadataJson: true },
  })
  const gmailDraftId = draft ? gmailDraftIdFromMetadata(draft.metadataJson) : null
  if (!gmailDraftId) return

  await deleteGmailDraft(job.channelId, gmailDraftId)

  const meta = asMetadataObject(draft?.metadataJson)
  delete meta.gmailDraftId
  await prisma.draft.update({
    where: { conversationId: job.conversationId },
    data: { metadataJson: meta as Prisma.InputJsonValue },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: job.tenantId,
      action: "gmail.draft.withdrawn",
      payloadJson: { conversationId: job.conversationId, channelId: job.channelId, gmailDraftId },
    },
  })
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const jobs = await prisma.gmailWritebackQueue.findMany({
    where: {
      status: "pending",
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 25,
  })

  let processed = 0
  let errors = 0

  for (const job of jobs) {
    // Atomic pending → processing claim so overlapping cron runs never
    // double-process a job (same lease pattern as lib/agent/job-executor.ts).
    const claim = await prisma.gmailWritebackQueue.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "processing" },
    })
    if (claim.count !== 1) continue

    try {
      if (job.action === "mark_read") {
        const providerMessageIds = asStringArray(job.providerMessageIdsJson)
        await markGmailThreadRead(job.channelId, providerMessageIds, {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
        })
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
          errors++
          continue
        }
        await applyFlowDeskLabelsToGmailThread(job.channelId, payload.threadId, payload.labels)
        await prisma.auditLog.create({
          data: {
            tenantId: job.tenantId,
            action: "gmail.labels.applied",
            payloadJson: {
              conversationId: job.conversationId,
              channelId: job.channelId,
              threadId: payload.threadId,
              labels: payload.labels,
            },
          },
        })
      } else if (job.action === GMAIL_DRAFT_CREATE_ACTION) {
        await handleCreateDraft(job)
      } else if (job.action === GMAIL_DRAFT_WITHDRAW_ACTION) {
        await handleWithdrawDraft(job)
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
        errors++
        continue
      }

      await prisma.gmailWritebackQueue.update({
        where: { id: job.id },
        data: {
          status: "completed",
          lastError: null,
        },
      })
      processed++
    } catch (err) {
      // Exponential backoff between retries; fail out permanently once the
      // attempt budget is spent so a broken job can't hot-loop every cron run.
      const attempts = job.attempts + 1
      const failedOut = attempts >= GMAIL_WRITEBACK_MAX_ATTEMPTS
      await prisma.gmailWritebackQueue.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: err instanceof Error ? err.message : "Unknown Gmail writeback error",
          status: failedOut ? "failed" : "pending",
          ...(failedOut ? {} : { nextAttemptAt: nextWritebackAttemptDate(attempts) }),
        },
      }).catch(() => {})
      errors++
    }
  }

  return NextResponse.json(
    { processed, errors },
    {
      status: errors > 0 ? 500 : 200,
      headers: { "X-Gmail-Writeback-Errors": String(errors) },
    }
  )
}
