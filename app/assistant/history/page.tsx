import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import RuleHistoryList from "@/app/assistant/RuleHistoryList"

export const dynamic = "force-dynamic"

// Action string literals verified against the AuditLog.create() call sites
// in app/api/agent-rules/route.ts, app/api/agent-rules/[id]/route.ts,
// app/api/agent-rules/[id]/versions/route.ts, and
// app/api/agent-rules/dry-run/route.ts.
const RULE_AUDIT_ACTIONS = [
  "agent_rule.create",
  "agent_rule.update",
  "agent_rule.version_snapshot",
  "agent_rule.delete",
  "agent_rule.dry_run",
]

export default async function AssistantHistoryPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const auditEntriesRaw = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: { in: RULE_AUDIT_ACTIONS },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const auditEntries = auditEntriesRaw.map((entry) => ({
    id: entry.id,
    action: entry.action,
    createdAt: entry.createdAt.toISOString(),
    payloadJson: entry.payloadJson,
  }))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">History</h2>
      <p className="mb-4 text-sm text-slate-500">
        Rule creations, edits, version changes, and dry-run tests — newest first.
      </p>
      <RuleHistoryList entries={auditEntries} />
    </section>
  )
}
