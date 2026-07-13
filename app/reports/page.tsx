import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import AppShell from "@/app/components/AppShell"
import { authOptions } from "@/lib/auth"
import { buildWeeklyValueReport, getWeeklyTrend } from "@/lib/agent/value-report"
import { prisma } from "@/lib/prisma"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"

export const dynamic = "force-dynamic"

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours.toFixed(1)} hours`
}

function formatPipelineValue(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value}`
}

const PIPELINE_STAGES = ["qualified", "contacted", "proposal", "closing", "won"] as const

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export default async function ReportsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenantId = session.user.tenantId

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) redirect("/home")

  const report = await buildWeeklyValueReport(tenantId)

  const [trendSnapshots, pipelineLeads, recentLeads] = await Promise.all([
    getWeeklyTrend(tenantId, 4),
    prisma.lead.findMany({
      where: { tenantId, stage: { not: "closed" } },
      select: { stage: true, estimatedValue: true },
    }),
    prisma.lead.findMany({
      where: {
        tenantId,
        createdAt: { gte: report.periodStart },
        estimatedValue: { gt: 0 },
      },
      select: {
        estimatedValue: true,
        score: true,
        scoreExplanation: true,
        conversationId: true,
        conversation: { select: { contact: { select: { name: true } } } },
      },
      orderBy: { estimatedValue: "desc" },
      take: 6,
    }),
  ])

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

  // --- Section 1: trend data ---
  type TrendKey = "draftsCreated" | "leadsDetected" | "followUpsQueued" | "approvalsDecided"
  const trendMetrics: Array<{ label: string; key: TrendKey }> = [
    { label: "Drafts created", key: "draftsCreated" },
    { label: "Leads detected", key: "leadsDetected" },
    { label: "Follow-ups queued", key: "followUpsQueued" },
    { label: "Approvals decided", key: "approvalsDecided" },
  ]

  // --- Section 2: pipeline data ---
  const totalLeads = pipelineLeads.length
  const totalValue = pipelineLeads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0)
  const formattedPipelineValue = formatPipelineValue(totalValue)

  type StageGroup = { count: number; sum: number }
  const stageGroups: Record<string, StageGroup> = {}
  for (const lead of pipelineLeads) {
    if (!stageGroups[lead.stage]) stageGroups[lead.stage] = { count: 0, sum: 0 }
    stageGroups[lead.stage].count += 1
    stageGroups[lead.stage].sum += lead.estimatedValue ?? 0
  }

  return (
    <AppShell tenantId={tenantId}>
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
              &larr; Back to inbox
            </Link>
            <h1 className="mt-1 font-serif text-2xl font-normal">Weekly value report</h1>
            <p className="text-sm text-slate-500">
              {report.periodStart.toLocaleDateString()} &ndash; {report.periodEnd.toLocaleDateString()}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Headline card */}
        <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-medium text-slate-900">{headline}</p>
          <p className="mt-2 text-xs text-slate-600">
            Time saved is a conservative estimate: 4 min per draft, 3 min per follow-up, 2 min per
            extracted task, 5 min per detected lead.
          </p>
        </section>

        {/* Metric grid */}
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

        {/* Time saved card */}
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Estimated time saved</h2>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">
            {formatMinutes(report.estimatedMinutesSaved)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Counted over the last 7 days from drafts, follow-ups, tasks, and leads.
          </p>
        </section>

        {/* Section 1: 4-week trend bars */}
        {trendSnapshots.length >= 2 && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">4-week trend</h2>
            {trendMetrics.map(({ label, key }) => {
              const values = trendSnapshots.map((snap) => snap[key] ?? 0)
              const maxInRow = Math.max(...values)
              return (
                <div key={key} className="flex items-start gap-2 mb-3">
                  <span className="w-40 shrink-0 text-sm text-slate-600 pt-5">{label}</span>
                  <div className="flex gap-2 flex-1">
                    {trendSnapshots.map((snap) => {
                      const value = snap[key] ?? 0
                      const pct = maxInRow === 0 ? 0 : Math.round((value / maxInRow) * 100)
                      const weekLabel = snap.weekEnding.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                      return (
                        <div
                          key={snap.weekEnding.toISOString()}
                          className="flex flex-col items-center flex-1"
                        >
                          <span className="text-xs text-slate-500 mb-1">{weekLabel}</span>
                          <div className="w-full bg-slate-100 rounded h-6 flex items-end">
                            <div
                              className="bg-[var(--color-accent)] rounded"
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                minWidth: value > 0 ? "4px" : "0",
                              }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 mt-1">{value}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {/* Section 2: Pipeline value summary */}
        {totalLeads > 0 && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Pipeline value summary</h2>
            <p className="text-xl font-bold text-slate-900">
              {formattedPipelineValue} across {totalLeads} lead{totalLeads === 1 ? "" : "s"}
            </p>
            <div className="mt-4 space-y-3">
              {PIPELINE_STAGES.filter((stage) => stageGroups[stage]?.count > 0).map((stage) => {
                const { count, sum } = stageGroups[stage]
                const barPct = Math.round((count / totalLeads) * 100)
                return (
                  <div key={stage}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-600">{capitalizeFirst(stage)}</span>
                      <span className="text-sm text-slate-500">
                        {count} lead{count === 1 ? "" : "s"}
                        {sum > 0 ? ` · ${formatPipelineValue(sum)}` : ""}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-emerald-400 h-2 rounded-full"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Section 3: Revenue opportunities this week */}
        {recentLeads.length > 0 && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              Revenue opportunities this week
            </h2>
            <div className="divide-y divide-slate-100">
              {recentLeads.map((lead) => {
                const contactName = lead.conversation?.contact?.name ?? "Unknown"
                const scoreColor =
                  lead.score >= 70
                    ? "bg-green-100 text-green-700"
                    : lead.score >= 40
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
                const snippet = lead.scoreExplanation
                  ? lead.scoreExplanation.slice(0, 80)
                  : null
                return (
                  <div key={lead.conversationId} className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/conversations/${lead.conversationId}`}
                          className="text-sm font-medium text-slate-800 hover:text-[var(--color-accent)]"
                        >
                          {contactName}
                        </Link>
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          ${(lead.estimatedValue ?? 0).toLocaleString()}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreColor}`}
                        >
                          Score {lead.score}
                        </span>
                      </div>
                      {snippet && (
                        <p className="mt-1 text-xs text-slate-500 truncate">
                          {snippet}
                          {lead.scoreExplanation && lead.scoreExplanation.length > 80 ? "…" : ""}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/conversations/${lead.conversationId}`}
                      className="shrink-0 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                    >
                      View &rarr;
                    </Link>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </main>
    </div>
    </AppShell>
  )
}
