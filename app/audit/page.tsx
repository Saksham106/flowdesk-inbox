import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const AGENT_ACTIONS = [
  "agent_job.completed",
  "agent_job.failed",
  "autopilot.send",
  "autopilot.send_failed",
  "autopilot.draft_approved",
  "autopilot.draft_failed",
  "autopilot.failure_recorded",
  "autopilot.disabled_after_failures",
  "follow_up.job_created",
  "follow_up.due_labeled",
  "calendar_hold.created",
  "calendar_hold.confirmed",
  "calendar_hold.cancelled",
  "calendar_hold.expired",
  "draft.suggest",
  "draft.approve",
  "draft.sent",
  "gmail.writeback.completed",
  "gmail.writeback.failed",
  "gmail.labels.queued",
  "conversation.waiting_on_detected",
  "conversation.waiting_on_cleared",
  "automation_level.changed",
]

const ACTION_COLORS: Record<string, string> = {
  "autopilot.send": "bg-green-100 text-green-800",
  "autopilot.send_failed": "bg-red-100 text-red-800",
  "autopilot.disabled_after_failures": "bg-red-100 text-red-800",
  "agent_job.failed": "bg-red-100 text-red-800",
  "agent_job.completed": "bg-blue-100 text-blue-800",
  "follow_up.job_created": "bg-purple-100 text-purple-800",
  "follow_up.due_labeled": "bg-amber-100 text-amber-800",
  "calendar_hold.confirmed": "bg-green-100 text-green-800",
  "calendar_hold.cancelled": "bg-slate-100 text-slate-600",
  "calendar_hold.expired": "bg-amber-100 text-amber-800",
  "gmail.writeback.completed": "bg-blue-100 text-blue-800",
  "gmail.writeback.failed": "bg-red-100 text-red-800",
  "gmail.labels.queued": "bg-slate-100 text-slate-600",
  "conversation.waiting_on_detected": "bg-purple-100 text-purple-800",
  "conversation.waiting_on_cleared": "bg-green-100 text-green-800",
  "automation_level.changed": "bg-amber-100 text-amber-800",
}

function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? "bg-slate-100 text-slate-700"
}

/**
 * Human-readable "why" for the audit row: surfaces the rule id/version/evidence
 * that drove a static-rule classification, the AI confidence for an LLM
 * classification, or the explicit reason when one was recorded.
 */
function whyText(payload: Record<string, unknown>): string | null {
  if (payload.classificationSource === "static_rule" && payload.ruleId) {
    const evidence = Array.isArray(payload.ruleEvidence)
      ? (payload.ruleEvidence as unknown[]).filter((v): v is string => typeof v === "string")
      : []
    const rule = `Rule ${String(payload.ruleId).slice(-6)} v${payload.ruleVersion ?? 1}`
    return evidence.length > 0 ? `${rule} — matched ${evidence.join(" and ")}` : rule
  }
  if (typeof payload.reason === "string" && payload.reason.trim()) return payload.reason
  if (typeof payload.result === "string" && payload.result.trim()) return payload.result
  if (payload.classificationSource === "llm" && typeof payload.confidence === "number") {
    return `AI — ${Math.round(payload.confidence * 100)}% confident`
  }
  return null
}

interface Props {
  searchParams: { page?: string; action?: string }
}

export default async function AuditPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenantId = session.user.tenantId
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accountType: true },
  })
  const isPersonal = tenant?.accountType === "personal"
  const auditActionsForPersonal = [
    "conversation.attention_corrected",
    "person_memory.synced",
    "draft.suggest",
    "draft.approve",
    "draft.sent",
  ]

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10))
  const pageSize = 50
  const filterAction = searchParams.action

  const allowedActions = isPersonal ? auditActionsForPersonal : AGENT_ACTIONS
  const where = {
    tenantId,
    action: filterAction && allowedActions.includes(filterAction)
      ? filterAction
      : { in: allowedActions },
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ])

  const totalPages = Math.ceil(total / pageSize)

  function pageHref(p: number) {
    const params = new URLSearchParams()
    params.set("page", String(p))
    if (filterAction) params.set("action", filterAction)
    return `/audit?${params.toString()}`
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Agent &amp; Autopilot Audit Log</h1>
            <p className="text-sm text-slate-500">{total.toLocaleString()} events</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        {/* Action filter */}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/audit"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !filterAction
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            All
          </Link>
          {["autopilot.send", "agent_job.completed", "agent_job.failed", "gmail.writeback.completed", "gmail.writeback.failed", "follow_up.due_labeled"].map(
            (action) => (
              <Link
                key={action}
                href={`/audit?action=${action}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  filterAction === action
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {action}
              </Link>
            )
          )}
        </div>

        {/* Log table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {logs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">No events found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                  <th className="px-4 py-3 text-left font-medium">By</th>
                  <th className="px-4 py-3 text-left font-medium">Details</th>
                  <th className="px-4 py-3 text-left font-medium">Why</th>
                  <th className="px-4 py-3 text-left font-medium">Undo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logs.map((log) => {
                  const payload = log.payloadJson as Record<string, unknown>
                  return (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {log.createdAt.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: true,
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {log.user?.email ?? "system"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {payload.conversationId ? (
                          <Link
                            href={`/conversations/${payload.conversationId}`}
                            className="underline hover:text-slate-700"
                          >
                            {String(payload.conversationId).slice(-8)}
                          </Link>
                        ) : null}
                        {payload.intent != null && (
                          <span className="ml-2 text-slate-400">
                            intent: {String(payload.intent)}{" "}
                            {payload.confidence != null
                              ? `(${(Number(payload.confidence) * 100).toFixed(0)}%)`
                              : ""}
                          </span>
                        )}
                        {payload.error != null && (
                          <span className="ml-2 text-red-500">{String(payload.error)}</span>
                        )}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-slate-500">
                        {whyText(payload) ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {log.action === "autopilot.draft_approved" && (
                          <form action={`/api/audit/${log.id}/undo`} method="POST">
                            <button
                              type="submit"
                              className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              Undo
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-slate-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
