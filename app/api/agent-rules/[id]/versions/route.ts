import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// Version history for a rule: the live row is the current version; prior
// versions live as AuditLog snapshots written on each behavior-changing edit.

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  const rule = await prisma.agentRule.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const snapshots = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: "agent_rule.version_snapshot",
      payloadJson: { path: ["ruleId"], equals: params.id },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  const versions = snapshots.map((row) => {
    const payload =
      typeof row.payloadJson === "object" && row.payloadJson !== null && !Array.isArray(row.payloadJson)
        ? (row.payloadJson as Record<string, unknown>)
        : {}
    return {
      version: payload.version ?? null,
      plainText: payload.plainText ?? null,
      conditionsJson: payload.conditionsJson ?? null,
      actionJson: payload.actionJson ?? null,
      status: payload.status ?? null,
      snapshotAt: row.createdAt,
    }
  })

  return NextResponse.json({
    current: {
      id: rule.id,
      version: rule.version,
      plainText: rule.plainText,
      conditionsJson: rule.conditionsJson,
      actionJson: rule.actionJson,
      status: rule.status,
      lastDryRunAt: rule.lastDryRunAt,
      updatedAt: rule.updatedAt,
    },
    versions,
  })
}
