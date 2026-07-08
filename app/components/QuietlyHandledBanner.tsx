import Link from "next/link"
import type { QuietlyHandledBreakdown } from "@/lib/agent/command-center"

interface Props {
  count: number
  breakdown: QuietlyHandledBreakdown
}

export default function QuietlyHandledBanner({ count, breakdown }: Props) {
  if (count === 0) return null

  // href is the same content-type filter used by the inbox list column
  // (lib/content-type-filters.ts), so clicking a pill jumps straight to the
  // matching Gmail-labeled set of conversations instead of just displaying a count.
  const pills: { label: string; value: number; href?: string }[] = [
    { label: "newsletters", value: breakdown.newsletter, href: "/inbox?type=newsletter" },
    { label: "notifications", value: breakdown.notification, href: "/inbox?type=notification" },
    { label: "marketing", value: breakdown.marketing, href: "/inbox?type=marketing" },
    { label: "calendar", value: breakdown.calendar, href: "/inbox?type=calendar" },
    { label: "other", value: breakdown.other },
  ].filter((p) => p.value > 0)

  return (
    <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3">
      <span className="text-2xl font-extrabold text-slate-300 flex-shrink-0">{count}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-500">emails sorted quietly</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pills.map(({ label, value, href }) =>
            href ? (
              <Link
                key={label}
                href={href}
                className="text-[9px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
              >
                {value} {label}
              </Link>
            ) : (
              <span
                key={label}
                className="text-[9px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500"
              >
                {value} {label}
              </span>
            )
          )}
        </div>
      </div>
      <Link
        href="/inbox?status=closed"
        className="text-[10px] font-semibold text-slate-500 border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 hover:bg-slate-100 transition flex-shrink-0"
      >
        Review all →
      </Link>
    </div>
  )
}
