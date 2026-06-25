import { NextResponse } from "next/server"

import { normalizeFlowDeskLabelPayload } from "@/lib/gmail-labels"
import { applyFlowDeskLabelsToGmailThread, markGmailThreadRead } from "@/lib/google"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
      } else {
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
      await prisma.gmailWritebackQueue.update({
        where: { id: job.id },
        data: {
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message : "Unknown Gmail writeback error",
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
