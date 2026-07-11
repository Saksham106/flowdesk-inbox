import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

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
    automationLevel,
  } = body as {
    enabled?: boolean
    confidenceThreshold?: number
    allowedIntents?: string[]
    maxAutoSendsPerDay?: number
    disableAfterFailures?: number
    resetFailures?: boolean
    categoryThresholds?: Record<string, unknown>
    automationLevel?: number
  }

  const updateData: Record<string, unknown> = {}

  if (automationLevel !== undefined) {
    if (
      typeof automationLevel !== "number" ||
      !Number.isInteger(automationLevel) ||
      automationLevel < 0 ||
      automationLevel > 5
    ) {
      return NextResponse.json(
        { error: "automationLevel must be an integer between 0 and 5" },
        { status: 400 }
      )
    }
    updateData.automationLevel = automationLevel
  }

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
    const VALID_ACTIONS = ["auto_send", "require_approval", "never"]
    for (const [key, value] of Object.entries(categoryThresholds)) {
      if (typeof value === "number") {
        // Legacy format: bare number threshold
        if (!Number.isFinite(value) || value < 0.5 || value > 1) {
          return NextResponse.json(
            { error: `categoryThresholds["${key}"] must be a number between 0.5 and 1.0` },
            { status: 400 }
          )
        }
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        // New format: CategoryPolicy object { action, threshold? }
        const policy = value as Record<string, unknown>
        if (!VALID_ACTIONS.includes(policy.action as string)) {
          return NextResponse.json(
            { error: `categoryThresholds["${key}"].action must be one of: ${VALID_ACTIONS.join(", ")}` },
            { status: 400 }
          )
        }
        if (policy.threshold !== undefined && policy.threshold !== null) {
          const t = policy.threshold as number
          if (typeof t !== "number" || !Number.isFinite(t) || t < 0.5 || t > 1) {
            return NextResponse.json(
              { error: `categoryThresholds["${key}"].threshold must be a number between 0.5 and 1.0` },
              { status: 400 }
            )
          }
        }
      } else {
        return NextResponse.json(
          { error: `categoryThresholds["${key}"] must be a number or a policy object` },
          { status: 400 }
        )
      }
    }
    updateData.categoryThresholdsJson = categoryThresholds
  }

  const existing = await prisma.autopilotSetting.findUnique({
    where: { tenantId: session.user.tenantId },
    select: { automationLevel: true },
  })

  const [setting] = await prisma.$transaction([
    prisma.autopilotSetting.upsert({
      where: { tenantId: session.user.tenantId },
      update: updateData,
      // Apply the patched values on first save too, not just defaults.
      create: {
        tenantId: session.user.tenantId,
        enabled: false,
        ...updateData,
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId: session.user.tenantId,
        action: "autopilot_setting.update",
        payloadJson: updateData as Prisma.InputJsonValue,
      },
    }),
    // Level changes get their own audit trail: the trust ladder is the
    // primary user-facing control and takes effect immediately in the gates.
    ...(automationLevel !== undefined && existing?.automationLevel !== automationLevel
      ? [
          prisma.auditLog.create({
            data: {
              tenantId: session.user.tenantId,
              userId: session.user.id ?? null,
              action: "automation_level.changed",
              payloadJson: {
                from: existing?.automationLevel ?? null,
                to: automationLevel,
              },
            },
          }),
        ]
      : []),
  ])

  const crossedIntoLevel3 =
    automationLevel !== undefined &&
    automationLevel >= 3 &&
    (existing?.automationLevel ?? 0) < 3

  if (!crossedIntoLevel3) {
    return NextResponse.json({ setting })
  }

  const backfillEligibleCount = await prisma.conversation.count({
    where: { tenantId: session.user.tenantId, status: "needs_reply", draft: null },
  })

  return NextResponse.json({ setting, backfillAvailable: true, backfillEligibleCount })
}
