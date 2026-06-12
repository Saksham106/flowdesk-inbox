import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { buildValueSnapshot } from "@/lib/agent/value-report"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let snapshotted = 0
    for (const tenant of tenants) {
      await buildValueSnapshot(tenant.id)
      snapshotted++
    }
    return NextResponse.json({ ok: true, snapshotted })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snapshot batch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
