import Link from "next/link"

import type { DailyCommandCenter } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"

const countItems = [
  ["needsReply", "Needs reply"],
  ["waitingOnThem", "Waiting"],
  ["approvals", "Approvals"],
  ["meetings", "Meetings"],
  ["opportunities", "Opportunities"],
  ["potentialProblems", "Problems"],
  ["support", "Support"],
  ["salesQualified", "Sales Qualified"],
  ["safelyIgnored", "Ignored"],
] as const

export default function CommandCenterPanel({
  commandCenter,
  revenueAtRisk,
}: {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Today&apos;s Inbox Brief
        </p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-950 sm:text-2xl">
              {commandCenter.headline}
            </h2>
            <p className="mt-0.5 text-sm font-medium text-emerald-700">
              {commandCenter.droppedBallMessage}
            </p>
          </div>
          <Link
            href="/digest"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Open full brief
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:gap-3 sm:px-5 sm:py-4 lg:grid-cols-4">
        {countItems.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 sm:px-3">
            <p className="text-lg font-semibold text-slate-950 sm:text-xl">
              {commandCenter.counts[key]}
            </p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {revenueAtRisk.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
            Revenue at Risk
          </p>
          <ul className="space-y-2">
            {revenueAtRisk.map((item) => (
              <li key={item.conversationId}>
                <Link
                  href={`/conversations/${item.conversationId}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 transition hover:bg-amber-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.contactName}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      No reply in {item.daysSinceLastMessage} day{item.daysSinceLastMessage === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      At Risk
                    </span>
                    <span className="text-xs font-medium text-emerald-700">
                      ${item.estimatedValue.toLocaleString()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {commandCenter.topActions.length > 0 ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {commandCenter.topActions.slice(0, 4).map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block px-5 py-3 transition hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.displayName}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">{item.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
                      {item.priority}
                    </span>
                    {item.leadScore !== null && item.leadScore !== undefined ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.leadScore >= 70
                            ? "bg-emerald-100 text-emerald-700"
                            : item.leadScore >= 40
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.leadScore}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-500">
                  {item.nextAction}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
          Nothing needs immediate handling. The rest can stay safely quiet.
        </div>
      )}
    </section>
  )
}
