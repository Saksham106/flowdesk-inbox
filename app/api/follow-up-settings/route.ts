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

  const setting = await prisma.followUpSetting.findUnique({
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
  const { enabled, staleAfterDays, maxFollowUpsPerConversation } = body as {
    enabled?: boolean
    staleAfterDays?: number
    maxFollowUpsPerConversation?: number
  }

  const updateData: Record<string, unknown> = {}
  if (typeof enabled === "boolean") updateData.enabled = enabled
  if (typeof staleAfterDays === "number") {
    if (!Number.isInteger(staleAfterDays) || staleAfterDays < 1 || staleAfterDays > 30) {
      return NextResponse.json({ error: "staleAfterDays must be an integer between 1 and 30" }, { status: 400 })
    }
    updateData.staleAfterDays = staleAfterDays
  }
  if (typeof maxFollowUpsPerConversation === "number") {
    if (!Number.isInteger(maxFollowUpsPerConversation) || maxFollowUpsPerConversation < 1 || maxFollowUpsPerConversation > 10) {
      return NextResponse.json({ error: "maxFollowUpsPerConversation must be an integer between 1 and 10" }, { status: 400 })
    }
    updateData.maxFollowUpsPerConversation = maxFollowUpsPerConversation
  }

  const setting = await prisma.followUpSetting.upsert({
    where: { tenantId: session.user.tenantId },
    update: updateData,
    create: {
      tenantId: session.user.tenantId,
      enabled: typeof enabled === "boolean" ? enabled : false,
      staleAfterDays: typeof staleAfterDays === "number" ? staleAfterDays : 3,
      maxFollowUpsPerConversation: typeof maxFollowUpsPerConversation === "number" ? maxFollowUpsPerConversation : 2,
    },
  })

  return NextResponse.json({ setting })
}
