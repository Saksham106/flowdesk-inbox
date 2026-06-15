import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await request.json()
  const read = payload?.read

  if (typeof read !== "boolean") {
    return NextResponse.json({ error: "Missing read boolean" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data: {
      readAt: read ? new Date() : null,
      gmailUnread: read ? false : true,
    },
  })

  return NextResponse.json({ ok: true })
}
