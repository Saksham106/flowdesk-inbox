import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const { contactId } = params
  const body = await req.json()
  const { summary, preferences, openQuestions, promisedActions } = body

  const existing = await prisma.personMemory.findFirst({
    where: { contactId, tenantId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.personMemory.update({
    where: { id: existing.id },
    data: {
      ...(summary !== undefined ? { summary } : {}),
      ...(preferences !== undefined ? { preferences } : {}),
      ...(openQuestions !== undefined ? { openQuestions } : {}),
      ...(promisedActions !== undefined ? { promisedActions } : {}),
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "person_memory.user_edited",
      payloadJson: { contactId, reason: "User manually edited person memory" } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true })
}
