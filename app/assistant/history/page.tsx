import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// Action string literals verified against the AuditLog.create() call sites
// in app/api/agent-rules/route.ts and app/api/agent-rules/[id]/route.ts.
const RULE_AUDIT_ACTIONS = [
  "agent_rule.create",
  "agent_rule.update",
  "agent_rule.version_snapshot",
  "agent_rule.delete",
]

const RULE_ACTION_LABELS: Record<string, string> = {
  "agent_rule.create": "Rule created",
  "agent_rule.update": "Rule updated",
  "agent_rule.version_snapshot": "Rule version saved",
  "agent_rule.delete": "Rule removed",
}

// payloadJson shapes (see app/api/agent-rules/route.ts and
// app/api/agent-rules/[id]/route.ts): create uses `ruleId`, update/delete use
// `id`, version_snapshot uses `ruleId` + `version`. Normalize to a single
// secondary line rather than a full diff viewer — the payload doesn't carry
// enough of a before/after shape to justify one.
function ruleContext(payloadJson: unknown): string | null {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) return null
  const payload = payloadJson as Record<string, unknown>
  const ruleId = payload.ruleId ?? payload.id
  if (typeof ruleId !== "string") return null
  const version = typeof payload.version === "number" ? payload.version : null
  return version !== null ? `Rule ${ruleId} · v${version}` : `Rule ${ruleId}`
}

export default async function AssistantHistoryPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const auditEntries = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: { in: RULE_AUDIT_ACTIONS },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">History</h2>
      <p className="mb-4 text-sm text-slate-500">Rule version changes and related activity.</p>
      {auditEntries.length === 0 ? (
        <p className="text-sm text-slate-400">No rule activity yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {auditEntries.map((entry) => {
            const context = ruleContext(entry.payloadJson)
            return (
              <li key={entry.id} className="px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-slate-800">
                    {RULE_ACTION_LABELS[entry.action] ?? entry.action}
                  </span>{" "}
                  <span className="text-slate-400">{entry.createdAt.toLocaleString()}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {entry.action}
                  {context ? ` · ${context}` : ""}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
