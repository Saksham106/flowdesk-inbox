import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const vip = await prisma.vipContact.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!vip) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.vipContact.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
