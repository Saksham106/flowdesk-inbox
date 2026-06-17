import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAiBudgetStatus } from "@/lib/ai/budget"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const status = await getAiBudgetStatus(session.user.tenantId)
  return NextResponse.json(status)
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { dailyLimitUsd, monthlyLimitUsd } = body as Record<string, unknown>

  if (typeof dailyLimitUsd !== "number" || dailyLimitUsd < 0) {
    return NextResponse.json({ error: "dailyLimitUsd must be a non-negative number" }, { status: 400 })
  }
  if (typeof monthlyLimitUsd !== "number" || monthlyLimitUsd < 0) {
    return NextResponse.json({ error: "monthlyLimitUsd must be a non-negative number" }, { status: 400 })
  }
  if (dailyLimitUsd > monthlyLimitUsd) {
    return NextResponse.json({ error: "Daily limit cannot exceed monthly limit" }, { status: 400 })
  }

  await prisma.aiBudget.upsert({
    where: { tenantId: session.user.tenantId },
    create: { tenantId: session.user.tenantId, dailyLimitUsd, monthlyLimitUsd },
    update: { dailyLimitUsd, monthlyLimitUsd },
  })

  const status = await getAiBudgetStatus(session.user.tenantId)
  return NextResponse.json(status)
}
