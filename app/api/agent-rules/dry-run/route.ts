import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { extractEmail } from "@/lib/google"
import { parseStaticConditions, matchStaticConditions } from "@/lib/agent/static-rules"
import { deriveWorkflowStatus } from "@/lib/workflow-status"
import { flowDeskLabelsForConversationState } from "@/lib/email-labels"
import { getAutomationLevel, isActionAllowedAtLevel } from "@/lib/agent/automation-level"

// Preview a static rule against the tenant's recent conversations before it
// is enabled ("Preview before trust"). Read-only by design: the only writes
// are one AuditLog row recording that the dry-run happened and, when a saved
// rule is previewed, its lastDryRunAt timestamp (which gates enabling).
// No writeback rows, no Gmail calls, no conversation-state changes.

const MAX_SAMPLE = 200
const MAX_MATCH_DETAILS = 50

const ATTENTION_VALUES = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  const body = await request.json()
  const ruleId = typeof body?.ruleId === "string" ? body.ruleId : null
  if (!ruleId && !body?.conditions) {
    return NextResponse.json({ error: "ruleId or conditions required" }, { status: 400 })
  }

  let rawConditions: unknown = body?.conditions
  let rawAction: unknown = body?.action
  let ruleVersion: number | null = null

  if (ruleId) {
    const rule = await prisma.agentRule.findFirst({ where: { id: ruleId, tenantId } })
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })
    rawConditions = rule.conditionsJson
    rawAction = rule.actionJson
    ruleVersion = rule.version
  }

  const conditions = parseStaticConditions(rawConditions)
  if (!conditions) {
    return NextResponse.json(
      { error: "Conditions must include a sender email/domain or subject/body text" },
      { status: 422 }
    )
  }

  const actionRec =
    typeof rawAction === "object" && rawAction !== null ? (rawAction as Record<string, unknown>) : {}
  const targetAttention =
    typeof actionRec.targetAttention === "string" && ATTENTION_VALUES.includes(actionRec.targetAttention)
      ? actionRec.targetAttention
      : null

  const requestedSample = typeof body?.sampleSize === "number" ? body.sampleSize : MAX_SAMPLE
  const sampleSize = Math.min(Math.max(Math.trunc(requestedSample), 1), MAX_SAMPLE)

  const conversationsRaw = await prisma.conversation.findMany({
    where: { tenantId },
    orderBy: { lastMessageAt: "desc" },
    take: sampleSize,
    include: {
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { fromE164: true, subject: true, body: true, direction: true },
      },
    },
  })
  // The prisma mock in tests returns plain objects; keep the shape loose.
  const conversations = conversationsRaw as Array<{
    id: string
    messages: Array<{ fromE164: string | null; subject: string | null; body: string | null; direction?: string }>
  }>

  const matches: Array<{ conversationId: string; fromEmail: string; subject: string; evidence: string[] }> = []
  let matchedCount = 0
  for (const conversation of conversations) {
    const firstInbound = conversation.messages.find((m) => (m.direction ?? "inbound") === "inbound")
    if (!firstInbound?.fromE164) continue
    const fromEmail = extractEmail(firstInbound.fromE164).toLowerCase()
    const { matched, evidence } = matchStaticConditions(conditions, {
      fromEmail,
      subject: firstInbound.subject ?? "",
      body: firstInbound.body ?? "",
    })
    if (!matched) continue
    matchedCount += 1
    if (matches.length < MAX_MATCH_DETAILS) {
      matches.push({
        conversationId: conversation.id,
        fromEmail,
        subject: firstInbound.subject ?? "",
        evidence,
      })
    }
  }

  // What WOULD happen on a live match — computed, never executed here.
  const automationLevel = await getAutomationLevel(tenantId)
  const plannedAction = targetAttention
    ? {
        type: "set_attention",
        targetAttention,
        workflowStatus: deriveWorkflowStatus({ status: "open", attentionCategory: targetAttention }),
        gmailLabels: flowDeskLabelsForConversationState({
          workflowStatus: deriveWorkflowStatus({ status: "open", attentionCategory: targetAttention }),
          attentionCategory: targetAttention,
        }),
      }
    : null

  if (ruleId) {
    await prisma.agentRule.update({
      where: { id: ruleId },
      data: { lastDryRunAt: new Date() },
    })
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id ?? null,
      action: "agent_rule.dry_run",
      payloadJson: {
        ruleId,
        ruleVersion,
        conditions,
        targetAttention,
        sampleSize: conversations.length,
        matchedCount,
      } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({
    ok: true,
    ruleId,
    ruleVersion,
    sampleSize: conversations.length,
    matchedCount,
    skippedCount: conversations.length - matchedCount,
    matches,
    plannedAction,
    automationLevel,
    wouldApplyGmailLabels: isActionAllowedAtLevel(automationLevel, "apply_gmail_labels"),
  })
}
