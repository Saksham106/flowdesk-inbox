import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const snippets = await prisma.snippet.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: [{ status: "asc" }, { useCount: "desc" }],
  })
  return NextResponse.json({ snippets })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const { title, content } = await request.json()
  if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 })
  const [snippet] = await prisma.$transaction([
    prisma.snippet.create({
      data: { tenantId, title, content, status: "active", source: "manual" },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "snippet.create",
        payloadJson: { title, source: "manual" } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ snippet }, { status: 201 })
}
