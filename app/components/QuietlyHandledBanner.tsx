import Link from "next/link"
import type { QuietlyHandledBreakdown } from "@/lib/agent/command-center"

interface Props {
  count: number
  breakdown: QuietlyHandledBreakdown
}

export default function QuietlyHandledBanner({ count, breakdown }: Props) {
  if (count === 0) return null

  const pills: { label: string; value: number }[] = [
    { label: "newsletters", value: breakdown.newsletter },
    { label: "notifications", value: breakdown.notification },
    { label: "marketing", value: breakdown.marketing },
    { label: "other", value: breakdown.other },
  ].filter((p) => p.value > 0)

  return (
    <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3">
      <span className="text-2xl font-extrabold text-slate-300 flex-shrink-0">{count}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-500">emails quietly handled</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pills.map(({ label, value }) => (
            <span
              key={label}
              className="text-[9px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500"
            >
              {value} {label}
            </span>
          ))}
        </div>
      </div>
      <Link
        href="/inbox?attention=fyi_done"
        className="text-[10px] font-semibold text-slate-500 border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 hover:bg-slate-100 transition flex-shrink-0"
      >
        Review all →
      </Link>
    </div>
  )
}
