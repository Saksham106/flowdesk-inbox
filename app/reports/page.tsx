import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { buildWeeklyValueReport } from "@/lib/agent/value-report"

export const dynamic = "force-dynamic"

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours.toFixed(1)} hours`
}

export default async function ReportsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const report = await buildWeeklyValueReport(session.user.tenantId)

  const headline =
    report.draftsCreated + report.followUpsQueued + report.tasksExtracted + report.leadsDetected > 0
      ? `This week FlowDesk drafted ${report.draftsCreated} repl${report.draftsCreated === 1 ? "y" : "ies"}, queued ${report.followUpsQueued} follow-up${report.followUpsQueued === 1 ? "" : "s"}, extracted ${report.tasksExtracted} task${report.tasksExtracted === 1 ? "" : "s"}, detected ${report.leadsDetected} lead${report.leadsDetected === 1 ? "" : "s"}, and saved you an estimated ${formatMinutes(report.estimatedMinutesSaved)}.`
      : "No agent activity in the last 7 days yet. Connect an inbox and sync to see FlowDesk's work here."

  const metrics: Array<{ label: string; value: number; note: string }> = [
    { label: "Replies drafted", value: report.draftsCreated, note: "AI drafts created" },
    { label: "Replies sent", value: report.draftsSent, note: "approved drafts sent" },
    { label: "Tasks extracted", value: report.tasksExtracted, note: "promises and deadlines captured" },
    { label: "Tasks closed", value: report.tasksClosed, note: "marked done this week" },
    { label: "Leads detected", value: report.leadsDetected, note: "revenue signals found" },
    { label: "Follow-ups queued", value: report.followUpsQueued, note: "stale threads and lead sequences" },
    { label: "Approvals decided", value: report.approvalsDecided, note: "reviewed from the queue" },
    { label: "Conversations triaged", value: report.conversationsTriaged, note: "states kept up to date" },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Weekly value report</h1>
            <p className="text-sm text-slate-500">
              {report.periodStart.toLocaleDateString()} – {report.periodEnd.toLocaleDateString()}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <section className="mb-8 rounded-xl border border-blue-100 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-900">{headline}</p>
          <p className="mt-2 text-xs text-blue-700">
            Time saved is a conservative estimate: 4 min per draft, 3 min per follow-up, 2 min per
            extracted task, 5 min per detected lead.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-2xl font-semibold text-slate-900">{metric.value}</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{metric.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{metric.note}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Estimated time saved</h2>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">
            {formatMinutes(report.estimatedMinutesSaved)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Counted over the last 7 days from drafts, follow-ups, tasks, and leads.
          </p>
        </section>
      </main>
    </div>
  )
}
