import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export const runtime = "nodejs"

// Must stay in sync with CommandCenterPriority (lib/agent/command-center.ts) — any
// other value NaNs the command-center score lookup.
const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low", "none"])

function restorablePriority(value: unknown): string {
  return typeof value === "string" && VALID_PRIORITIES.has(value) ? value : "medium"
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const due = await prisma.snoozeReminder.findMany({
    where: { status: "pending", snoozeUntil: { lte: now } },
    select: { id: true, conversationId: true, tenantId: true },
    take: 100,
  })

  let fired = 0
  for (const snooze of due) {
    await prisma.snoozeReminder.update({ where: { id: snooze.id }, data: { status: "fired" } })

    const state = await prisma.conversationState.findUnique({
      where: { conversationId: snooze.conversationId },
      select: { metadataJson: true },
    })
    const meta =
      state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
        ? (state.metadataJson as Record<string, unknown>)
        : {}

    await prisma.conversationState.update({
      where: { conversationId: snooze.conversationId },
      data: {
        priority: restorablePriority(meta.preSnoozePriority),
        metadataJson: {
          ...meta,
          resurfacedFromSnooze: true,
          snoozeReminderId: null,
          preSnoozePriority: null,
        } as Prisma.InputJsonValue,
      },
    })
    fired++
  }

  return NextResponse.json({ ok: true, fired })
}
