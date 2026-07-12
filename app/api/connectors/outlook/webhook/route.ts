import { NextResponse } from "next/server"
import {
  InvalidOutlookNotification,
  queueOutlookNotifications,
} from "@/lib/outlook-notifications"
import { processOutlookSyncWork } from "@/lib/outlook-worker"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get("validationToken")
  if (validationToken !== null) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const result = await queueOutlookNotifications(payload)
    // Best-effort inline drain so mailbox changes reflect within seconds of
    // the push, matching Gmail's behavior — without this, queued events wait
    // for the next outlook-sync cron tick (up to 5 minutes). The cron remains
    // the reliability backstop; event claims are atomic, so overlap is safe.
    if (result.queued > 0) {
      void processOutlookSyncWork().catch((err) => {
        console.error("[outlook/webhook] inline sync drain failed, cron will retry:", err)
      })
    }
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    if (error instanceof InvalidOutlookNotification) {
      return NextResponse.json({ error: "Invalid notification" }, { status: error.status })
    }
    return NextResponse.json({ error: "Notification intake failed" }, { status: 500 })
  }
}
