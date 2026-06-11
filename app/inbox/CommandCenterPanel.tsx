import Link from "next/link"

import type { DailyCommandCenter } from "@/lib/agent/command-center"

const countItems = [
  ["needsReply", "Needs reply"],
  ["waitingOnThem", "Waiting"],
  ["approvals", "Approvals"],
  ["meetings", "Meetings"],
  ["opportunities", "Opportunities"],
  ["potentialProblems", "Problems"],
  ["safelyIgnored", "Ignored"],
] as const

export default function CommandCenterPanel({
  commandCenter,
}: {
  commandCenter: DailyCommandCenter
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Today&apos;s Inbox Brief
        </p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">
              {commandCenter.headline}
            </h2>
            <p className="mt-1 text-sm font-medium text-emerald-700">
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

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        {countItems.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-xl font-semibold text-slate-950">
              {commandCenter.counts[key]}
            </p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

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
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
                    {item.priority}
                  </span>
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
