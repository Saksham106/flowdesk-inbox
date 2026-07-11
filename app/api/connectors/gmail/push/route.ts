import { NextResponse } from "next/server"

import { processGmailPushNotification } from "@/lib/gmail-sync"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const configuredSecret = process.env.GMAIL_PUSH_SECRET
  const { searchParams } = new URL(request.url)
  const providedSecret = searchParams.get("secret") ?? request.headers.get("x-flowdesk-secret")

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const payload = await request.json()
    const result = await processGmailPushNotification(payload)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail push processing failed"
    console.error("[gmail-push] processing failed:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
