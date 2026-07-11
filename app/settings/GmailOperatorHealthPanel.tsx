import type { GmailOperatorHealthSummary, GmailOperatorHealthStatus } from "@/lib/gmail-operator-health"

const STATUS_STYLE: Record<GmailOperatorHealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-red-200 bg-red-50 text-red-800",
}

const DOT_STYLE: Record<GmailOperatorHealthStatus, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
}

export default function GmailOperatorHealthPanel({
  summary,
  title = "Gmail operator health",
  description = "Tracks sync, push, writeback, and agent jobs.",
}: {
  summary: GmailOperatorHealthSummary
  title?: string
  description?: string
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${STATUS_STYLE[summary.status]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs">{summary.headline}</p>
          <p className="mt-1 text-[11px] opacity-80">{description}</p>
        </div>
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-medium capitalize">
          {summary.status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {summary.checks.map((check) => (
          <div key={check.id} className="rounded-md border border-white/70 bg-white/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${DOT_STYLE[check.status]}`} />
              <p className="text-xs font-semibold text-slate-800">{check.label}</p>
            </div>
            <p className="mt-1 text-xs text-slate-600">{check.detail}</p>
            <p className="mt-1 text-[11px] text-slate-500">{check.action}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
