import type { AgentSummary, QuietlyHandledBreakdown } from "@/lib/agent/command-center"

interface ActivityRow {
  icon: string
  text: string
  timestamp: string
}

interface Props {
  agentSummary: AgentSummary
  quietlyHandledBreakdown: QuietlyHandledBreakdown
}

export default function AgentActivitySection({ agentSummary, quietlyHandledBreakdown }: Props) {
  const rows: ActivityRow[] = []

  if (agentSummary.classifiedLast24h > 0) {
    rows.push({
      icon: "✦",
      text: `Sorted ${agentSummary.classifiedLast24h} email${agentSummary.classifiedLast24h === 1 ? "" : "s"} today`,
      timestamp: "today",
    })
  }

  const quietCount = quietlyHandledBreakdown.newsletter + quietlyHandledBreakdown.notification + quietlyHandledBreakdown.marketing
  if (quietCount > 0) {
    rows.push({
      icon: "✦",
      text: `Moved ${quietCount} newsletter${quietCount === 1 ? "" : "s"} & update${quietCount === 1 ? "" : "s"} to Quiet`,
      timestamp: "today",
    })
  }

  if (agentSummary.draftedLast24h > 0) {
    rows.push({
      icon: "✉",
      text: `Drafted ${agentSummary.draftedLast24h} ${agentSummary.draftedLast24h === 1 ? "reply" : "replies"} for your review`,
      timestamp: "today",
    })
  }

  if (agentSummary.learnedRecentlyUpdated) {
    rows.push({
      icon: "🧠",
      text: "Learned from your recent feedback",
      timestamp: "this week",
    })
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <p className="text-[10px] font-bold uppercase tracking-wide text-green-600">Agent Activity</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        {rows.length === 0 ? (
          <p className="text-[10px] text-slate-400">All quiet — no activity in the last 24 hours.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[11px] w-4 text-center flex-shrink-0 mt-px">{row.icon}</span>
                <span className="text-[11px] text-slate-500 flex-1 leading-snug">{row.text}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{row.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
