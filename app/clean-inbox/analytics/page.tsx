import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import { computeCleanupTrend, getCleanupOverview, getPreviousCleanupOverview, type CleanupTrend } from "@/lib/cleanup-candidates"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"
import { CLEANUP_RANGE_OPTIONS, parseCleanupRange } from "@/lib/cleanup-range"

export const dynamic = "force-dynamic"

const TOP_DOMAINS_VISIBLE = 5

export default async function CleanupAnalyticsPage({ searchParams }: { searchParams: { range?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)
  const range = parseCleanupRange(searchParams.range)
  const rangeLabel = CLEANUP_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "this period"

  const [{ groups, analytics }, previousOverview] = await Promise.all([
    getCleanupOverview(tenantId, range),
    getPreviousCleanupOverview(tenantId, range),
  ])
  const trend = computeCleanupTrend(analytics, previousOverview?.analytics ?? null)

  const visibleDomains = analytics.topDomains.slice(0, TOP_DOMAINS_VISIBLE)
  const hiddenDomains = analytics.topDomains.slice(TOP_DOMAINS_VISIBLE)

  return (
    <>
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:flex">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden lg:overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 pt-8">
            <CleanupTabNav range={range} />
          </div>
          <main className="mx-auto max-w-5xl px-6 pb-8">
            <h1 className="text-xl font-semibold text-slate-900">Cleanup Analytics</h1>

            {/* Headline: the one number that matters, with a trend badge vs. the prior period. */}
            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-4xl font-semibold tabular-nums text-slate-900">{analytics.totalCleanable}</p>
                <TrendBadge trend={trend} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                cleanable conversations across {groups.length} senders &mdash; {rangeLabel.toLowerCase()}
              </p>
              <div className="mt-4 flex items-baseline gap-2 border-t border-slate-100 pt-4">
                <span className="text-lg font-semibold text-slate-700">{analytics.unsubscribableCount}</span>
                <span className="text-sm text-slate-500">have an unsubscribe link</span>
              </div>
            </section>

            {analytics.protectedOrSkipped > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                {analytics.protectedOrSkipped} more protected by safety rules (needs reply, waiting on, receipts,
                etc.) and excluded.
              </p>
            )}

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="rounded-xl border border-slate-100 bg-white p-4">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">By content type</h2>
                <ul className="space-y-1 text-sm font-normal">
                  {analytics.byEmailType.map(([type, count]) => (
                    <li key={type} className="flex justify-between">
                      <span className="text-slate-500">{type}</span>
                      <span className="text-slate-700">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-slate-700">Top domains</h2>
                <ul className="space-y-1 text-sm">
                  {visibleDomains.map(([domain, count]) => (
                    <li key={domain} className="flex justify-between">
                      <span className="text-slate-600">{domain}</span>
                      <span className="text-slate-900">{count}</span>
                    </li>
                  ))}
                </ul>
                {hiddenDomains.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-800">
                      Show {hiddenDomains.length} more
                    </summary>
                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm">
                      {hiddenDomains.map(([domain, count]) => (
                        <li key={domain} className="flex justify-between">
                          <span className="text-slate-600">{domain}</span>
                          <span className="text-slate-900">{count}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}

function TrendBadge({ trend }: { trend: CleanupTrend }) {
  if (trend.direction === "flat") {
    return (
      <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        No change
      </span>
    )
  }

  // Fewer cleanable conversations is the improvement (green); more is the
  // regression (red). This is a deliberate semantic exception to the
  // neutral/near-black accent palette used elsewhere in the app.
  const isImprovement = trend.direction === "down"
  const label =
    trend.deltaPct === null
      ? `${trend.deltaAbs > 0 ? "+" : ""}${trend.deltaAbs} vs prior period`
      : `${trend.deltaPct > 0 ? "+" : ""}${Math.round(trend.deltaPct)}% vs prior period`

  return (
    <span
      className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        isImprovement ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      }`}
    >
      <span aria-hidden="true">{isImprovement ? "▼" : "▲"}</span>
      {label}
    </span>
  )
}
