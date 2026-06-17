import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { compileRule } from "@/lib/agent/rule-compiler"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const rules = await prisma.agentRule.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ rules })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const { plainText } = await request.json()
  if (!plainText || typeof plainText !== "string") {
    return NextResponse.json({ error: "plainText required" }, { status: 400 })
  }
  const compiled = await compileRule(plainText)
  if (compiled.confidence < 0.4) {
    return NextResponse.json({ error: "Could not understand that rule. Try rephrasing." }, { status: 422 })
  }
  const [rule] = await prisma.$transaction([
    prisma.agentRule.create({
      data: {
        tenantId,
        plainText,
        ruleType: compiled.ruleType,
        conditionsJson: compiled.conditionsJson as Prisma.InputJsonValue,
        actionJson: compiled.actionJson as Prisma.InputJsonValue,
        source: "plain_english",
        status: "active",
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.create",
        payloadJson: { plainText, ruleType: compiled.ruleType } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ rule }, { status: 201 })
}
