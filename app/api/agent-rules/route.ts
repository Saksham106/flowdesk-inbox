import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { compileRule, RuleCompileError, type CompiledRule } from "@/lib/agent/rule-compiler"
import { parseStaticConditions } from "@/lib/agent/static-rules"

const ATTENTION_VALUES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

function describeStaticRule(
  conditions: { matchType?: string; matchValue?: string; subjectContains?: string; bodyContains?: string },
  targetAttention: string
): string {
  const parts: string[] = []
  if (conditions.matchType === "email") parts.push(`from ${conditions.matchValue}`)
  if (conditions.matchType === "domain") parts.push(`from @${conditions.matchValue}`)
  if (conditions.subjectContains) parts.push(`subject contains "${conditions.subjectContains}"`)
  if (conditions.bodyContains) parts.push(`body contains "${conditions.bodyContains}"`)
  return `Emails ${parts.join(" and ")} → ${targetAttention.replace(/_/g, " ")}`
}

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
  const body = await request.json()
  const { plainText } = body

  // Structured static rules ("Static first, AI second"): explicit
  // sender/domain/subject/body conditions, no LLM compile. Created as drafts;
  // a dry-run preview is required before the rule can be enabled.
  if (body?.conditions) {
    const conditions = parseStaticConditions(body.conditions)
    if (!conditions) {
      return NextResponse.json(
        { error: "Conditions must include a sender email/domain or subject/body text" },
        { status: 422 }
      )
    }
    const targetAttention = body?.action?.targetAttention
    if (typeof targetAttention !== "string" || !ATTENTION_VALUES.includes(targetAttention)) {
      return NextResponse.json({ error: "action.targetAttention is invalid" }, { status: 422 })
    }
    const rule = await prisma.agentRule.create({
      data: {
        tenantId,
        plainText:
          typeof plainText === "string" && plainText.trim()
            ? plainText.trim()
            : describeStaticRule(conditions, targetAttention),
        ruleType: "attention",
        conditionsJson: conditions as Prisma.InputJsonValue,
        actionJson: { targetAttention } as Prisma.InputJsonValue,
        source: "manual",
        status: "draft",
      },
    })
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.create",
        payloadJson: {
          ruleId: rule.id,
          source: "manual",
          conditions,
          targetAttention,
        } as Prisma.InputJsonValue,
      },
    })
    return NextResponse.json({ rule }, { status: 201 })
  }

  if (!plainText || typeof plainText !== "string") {
    return NextResponse.json({ error: "plainText required" }, { status: 400 })
  }
  let compiled: CompiledRule
  try {
    compiled = await compileRule(tenantId, plainText)
  } catch (err) {
    if (err instanceof RuleCompileError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
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
