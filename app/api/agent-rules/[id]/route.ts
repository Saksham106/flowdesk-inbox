import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { parseStaticConditions } from "@/lib/agent/static-rules"

const ALLOWED_STATUSES = ["active", "dismissed", "suggested", "paused", "draft"]

const ATTENTION_VALUES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const body = await request.json()
  if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 422 })
  }
  const rule = await prisma.agentRule.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let newConditions: Prisma.InputJsonValue | undefined
  if (body.conditions !== undefined) {
    const parsed = parseStaticConditions(body.conditions)
    if (!parsed) {
      return NextResponse.json(
        { error: "Conditions must include a sender email/domain or subject/body text" },
        { status: 422 }
      )
    }
    newConditions = parsed as Prisma.InputJsonValue
  }

  let newAction: Prisma.InputJsonValue | undefined
  if (body.action !== undefined) {
    const targetAttention = body.action?.targetAttention
    if (typeof targetAttention !== "string" || !ATTENTION_VALUES.includes(targetAttention)) {
      return NextResponse.json({ error: "action.targetAttention is invalid" }, { status: 422 })
    }
    newAction = { targetAttention }
  }

  // Preview before trust: a draft rule must have been dry-run at least once
  // before it can start acting on real mail.
  const behaviorChange = Boolean(newConditions || newAction || body.plainText)
  if (
    body.status === "active" &&
    rule.status === "draft" &&
    !rule.lastDryRunAt
  ) {
    return NextResponse.json(
      { error: "Run a dry-run preview before enabling this rule" },
      { status: 422 }
    )
  }

  const updateData: Prisma.AgentRuleUpdateInput = {
    ...(body.status && { status: body.status }),
    ...(body.plainText && { plainText: body.plainText }),
    ...(newConditions !== undefined && { conditionsJson: newConditions }),
    ...(newAction !== undefined && { actionJson: newAction }),
  }

  const operations = []
  if (behaviorChange) {
    // Preserve the prior version as an AuditLog snapshot and invalidate the
    // previous dry-run — the preview no longer reflects the edited rule.
    updateData.version = rule.version + 1
    updateData.lastDryRunAt = null
    operations.push(
      prisma.auditLog.create({
        data: {
          tenantId,
          action: "agent_rule.version_snapshot",
          payloadJson: {
            ruleId: rule.id,
            version: rule.version,
            plainText: rule.plainText,
            conditionsJson: rule.conditionsJson,
            actionJson: rule.actionJson,
            status: rule.status,
          } as Prisma.InputJsonValue,
        },
      })
    )
  }

  const [updated] = await prisma.$transaction([
    prisma.agentRule.update({
      where: { id: params.id },
      data: updateData,
    }),
    ...operations,
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.update",
        payloadJson: {
          id: params.id,
          status: body.status,
          plainText: body.plainText,
          ...(newConditions !== undefined && { conditions: newConditions }),
          ...(newAction !== undefined && { action: newAction }),
          ...(behaviorChange && { version: rule.version + 1 }),
        } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ rule: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  await prisma.$transaction([
    prisma.agentRule.deleteMany({
      where: { id: params.id, tenantId },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "agent_rule.delete",
        payloadJson: { id: params.id } as Prisma.InputJsonValue,
      },
    }),
  ])
  return NextResponse.json({ ok: true })
}
