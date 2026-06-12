import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { buildValueSnapshot } from "@/lib/agent/value-report"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET env var is not set — value-snapshot cron will always reject")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let snapshotted = 0
    const errors: string[] = []
    for (const tenant of tenants) {
      try {
        await buildValueSnapshot(tenant.id)
        snapshotted++
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error"
        console.error(`value-snapshot: failed for tenant ${tenant.id}: ${msg}`)
        errors.push(tenant.id)
      }
    }
    return NextResponse.json({ ok: errors.length === 0, snapshotted, failed: errors.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
