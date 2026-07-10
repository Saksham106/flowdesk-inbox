import Link from "next/link"
import { MAIL_LABEL_TABS, type MailLabelTabValue } from "@/lib/mail-label-tabs"

type Props = {
  activeLabel: MailLabelTabValue | null
  counts: Record<MailLabelTabValue, number>
  /** Other active search params to preserve when switching tabs (e.g. q). */
  preserveQuery?: Record<string, string | undefined>
}

export default function MailTopTabs({ activeLabel, counts, preserveQuery }: Props) {
  const baseParams = new URLSearchParams(
    Object.entries(preserveQuery ?? {}).filter(([, v]) => v != null) as [string, string][],
  )

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-4">
      {MAIL_LABEL_TABS.map((tab) => {
        const params = new URLSearchParams(baseParams)
        // "All" is app-only — no Gmail label backs it — so its URL omits the
        // `label` param entirely rather than encoding a synthetic "all" value.
        if (tab.value !== "all") params.set("label", tab.value)
        // A null activeLabel (no/invalid `label` param) means "All" — there's
        // no `?label=all` URL for it, so it's the implicit default rather
        // than a value activeLabel is ever literally set to.
        const isActive = tab.value === "all" ? activeLabel === null : activeLabel === tab.value
        return (
          <Link
            key={tab.value}
            href={`/mail?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            {counts[tab.value] > 0 && (
              <span className="ml-1.5 text-xs text-slate-400">{counts[tab.value]}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
