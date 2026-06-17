import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const vips = await prisma.vipContact.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json({ vips })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const { email, domain, label } = body ?? {}
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 })
  }
  const vip = await prisma.vipContact.upsert({
    where: { tenantId_email: { tenantId: session.user.tenantId, email: email.toLowerCase() } },
    create: { tenantId: session.user.tenantId, email: email.toLowerCase(), domain: domain ?? null, label: label ?? null },
    update: { domain: domain ?? null, label: label ?? null },
  })
  return NextResponse.json({ vip })
}
