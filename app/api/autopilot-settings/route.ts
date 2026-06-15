import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const setting = await prisma.autopilotSetting.findUnique({
    where: { tenantId: session.user.tenantId },
  })

  return NextResponse.json({ setting })
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    enabled,
    confidenceThreshold,
    allowedIntents,
    maxAutoSendsPerDay,
    disableAfterFailures,
    resetFailures,
    categoryThresholds,
  } = body as {
    enabled?: boolean
    confidenceThreshold?: number
    allowedIntents?: string[]
    maxAutoSendsPerDay?: number
    disableAfterFailures?: number
    resetFailures?: boolean
    categoryThresholds?: Record<string, number>
  }

  const updateData: Record<string, unknown> = {}

  if (typeof enabled === "boolean") {
    updateData.enabled = enabled
    // Re-enabling clears the disabled timestamp
    if (enabled) {
      updateData.disabledAt = null
      updateData.currentFailures = 0
    }
  }
  if (typeof confidenceThreshold === "number") {
    if (confidenceThreshold < 0.5 || confidenceThreshold > 1) {
      return NextResponse.json({ error: "confidenceThreshold must be between 0.5 and 1.0" }, { status: 400 })
    }
    updateData.confidenceThreshold = confidenceThreshold
  }
  if (Array.isArray(allowedIntents)) {
    updateData.allowedIntentsJson = allowedIntents
  }
  if (typeof maxAutoSendsPerDay === "number") {
    if (!Number.isInteger(maxAutoSendsPerDay) || maxAutoSendsPerDay < 1 || maxAutoSendsPerDay > 100) {
      return NextResponse.json({ error: "maxAutoSendsPerDay must be an integer between 1 and 100" }, { status: 400 })
    }
    updateData.maxAutoSendsPerDay = maxAutoSendsPerDay
  }
  if (typeof disableAfterFailures === "number") {
    if (!Number.isInteger(disableAfterFailures) || disableAfterFailures < 1 || disableAfterFailures > 20) {
      return NextResponse.json({ error: "disableAfterFailures must be an integer between 1 and 20" }, { status: 400 })
    }
    updateData.disableAfterFailures = disableAfterFailures
  }
  if (resetFailures === true) {
    updateData.currentFailures = 0
    updateData.disabledAt = null
  }
  if (categoryThresholds !== undefined) {
    if (typeof categoryThresholds !== "object" || categoryThresholds === null || Array.isArray(categoryThresholds)) {
      return NextResponse.json({ error: "categoryThresholds must be an object" }, { status: 400 })
    }
    for (const [intent, threshold] of Object.entries(categoryThresholds)) {
      if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) {
        return NextResponse.json(
          { error: `categoryThresholds["${intent}"] must be a number between 0.5 and 1.0` },
          { status: 400 }
        )
      }
    }
    updateData.categoryThresholdsJson = categoryThresholds
  }

  const setting = await prisma.autopilotSetting.upsert({
    where: { tenantId: session.user.tenantId },
    update: updateData,
    create: {
      tenantId: session.user.tenantId,
      enabled: false,
    },
  })

  return NextResponse.json({ setting })
}
