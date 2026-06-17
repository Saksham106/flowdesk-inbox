import { NextResponse } from "next/server"

import { markGmailThreadRead } from "@/lib/google"
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
    if (job.action !== "mark_read") continue
    try {
      const providerMessageIds = asStringArray(job.providerMessageIdsJson)
      await markGmailThreadRead(job.channelId, providerMessageIds, {
        tenantId: job.tenantId,
        conversationId: job.conversationId,
      })
      await prisma.gmailWritebackQueue.update({
        where: { id: job.id },
        data: {
          status: "completed",
          lastError: null,
        },
      })
      processed++
    } catch {
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
