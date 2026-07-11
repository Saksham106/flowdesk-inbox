import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import type { Prisma } from "@prisma/client"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const ARRAY_FIELDS = ["preferredGreetings", "avoidedPhrases", "preferredSignoffs"] as const
const MAX_ARRAY_ITEMS = 20
const MAX_ARRAY_ITEM_LENGTH = 120
const MAX_CUSTOM_INSTRUCTION_LENGTH = 1_000

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const preferences = await prisma.writingPreference.findUnique({
    where: { tenantId: session.user.tenantId },
  })
  return NextResponse.json({ preferences })
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const update = validateUpdate(body as Record<string, unknown>)
  if (typeof update === "string") return NextResponse.json({ error: update }, { status: 400 })

  const tenantId = session.user.tenantId
  const [preferences] = await prisma.$transaction([
    prisma.writingPreference.upsert({
      where: { tenantId },
      update,
      create: { tenantId, ...update },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "writing_preferences.upsert",
        payloadJson: update as Prisma.InputJsonValue,
      },
    }),
  ])

  return NextResponse.json({ preferences })
}

function validateUpdate(body: Record<string, unknown>): Record<string, unknown> | string {
  const update: Record<string, unknown> = {}

  if (body.forbidEmDash !== undefined) {
    if (typeof body.forbidEmDash !== "boolean") return "forbidEmDash must be a boolean"
    update.forbidEmDash = body.forbidEmDash
  }

  for (const field of ARRAY_FIELDS) {
    const value = body[field]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return `${field} must be an array of strings`
    }
    if (value.length > MAX_ARRAY_ITEMS) return `${field} must contain at most ${MAX_ARRAY_ITEMS} items`
    const normalized = value.map((item) => item.trim()).filter(Boolean)
    if (normalized.some((item) => item.length > MAX_ARRAY_ITEM_LENGTH)) {
      return `${field} items must be ${MAX_ARRAY_ITEM_LENGTH} characters or fewer`
    }
    update[field] = [...new Set(normalized)]
  }

  for (const field of ["formality", "replyLength", "customInstruction"] as const) {
    const value = body[field]
    if (value === undefined) continue
    if (value !== null && typeof value !== "string") return `${field} must be text or null`
    const normalized = typeof value === "string" ? value.trim() : null
    if (field === "customInstruction" && normalized && normalized.length > MAX_CUSTOM_INSTRUCTION_LENGTH) {
      return `customInstruction must be ${MAX_CUSTOM_INSTRUCTION_LENGTH} characters or fewer`
    }
    update[field] = normalized || null
  }

  return update
}
