import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { compileRule, RuleCompileError, type CompiledRule } from "@/lib/agent/rule-compiler"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { plainText } = await request.json()
  if (!plainText) return NextResponse.json({ error: "plainText required" }, { status: 400 })

  const tenantId = session.user.tenantId
  let compiled: CompiledRule
  try {
    compiled = await compileRule(tenantId, plainText)
  } catch (err) {
    if (err instanceof RuleCompileError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }

  // Count matching conversations from last 90 days
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const cond = compiled.conditionsJson as unknown as Record<string, string>
  const matchType = cond.matchType
  const matchValue = (cond.matchValue ?? "").toLowerCase()

  let affectedCount = 0
  let examples: string[] = []

  if (matchType === "email" || matchType === "domain") {
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        phoneE164: matchType === "email"
          ? { equals: matchValue, mode: "insensitive" }
          : { contains: `@${matchValue}`, mode: "insensitive" },
      },
      select: { id: true, name: true },
      take: 10,
    })
    const contactIds = contacts.map((c) => c.id)
    if (contactIds.length > 0) {
      const convs = await prisma.conversation.findMany({
        where: { tenantId, contactId: { in: contactIds }, createdAt: { gte: since } },
        include: { messages: { take: 1, orderBy: { createdAt: "asc" } } },
        take: 5,
        orderBy: { lastMessageAt: "desc" },
      })
      affectedCount = convs.length
      examples = convs.flatMap((c) => c.messages.map((m) => m.subject ?? "(no subject)")).slice(0, 5)
    }
  }

  // Detect conflicts with existing active rules
  const conflicts = await prisma.agentRule.findMany({
    where: {
      tenantId,
      status: "active",
      conditionsJson: { path: ["matchValue"], equals: matchValue },
    },
    select: { id: true, plainText: true },
  })

  return NextResponse.json({ compiled, affectedCount, examples, conflicts })
}
