import type { TimelineEntry, TimelineTone, TimelineWhy } from "@/lib/agent/conversation-timeline"

const TONE_DOT: Record<TimelineTone, string> = {
  info: "bg-blue-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
  muted: "bg-slate-300",
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function WhyLine({ why }: { why: TimelineWhy }) {
  if (!why) return null

  if (why.kind === "rule") {
    return (
      <p className="mt-0.5 text-[11px] text-slate-400">
        <span className="font-medium text-slate-500">
          Rule {why.ruleId.slice(-6)} v{why.ruleVersion}
        </span>
        {why.evidence.length > 0 && <> — matched {why.evidence.join(" and ")}</>}
      </p>
    )
  }

  if (why.kind === "ai") {
    const pct = why.confidence != null ? `${Math.round(why.confidence * 100)}% confident` : null
    if (!pct) return null
    return <p className="mt-0.5 text-[11px] text-slate-400">AI — {pct}</p>
  }

  // manual
  return (
    <p className="mt-0.5 text-[11px] text-slate-400">
      You{why.by ? ` (${why.by})` : ""}
    </p>
  )
}

/**
 * Serializable shape the server page passes down — `createdAt` as an ISO string
 * so this stays a plain server component with no Date-across-boundary concerns.
 */
export type SerializedTimelineEntry = Omit<TimelineEntry, "createdAt"> & { createdAt: string }

export default function ConversationTimeline({ entries }: { entries: SerializedTimelineEntry[] }) {
  if (entries.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        What FlowDesk did
      </p>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2.5">
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-slate-700">
                    <span className="mr-1 text-slate-400">{entry.icon}</span>
                    {entry.title}
                  </p>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {formatWhen(entry.createdAt)}
                  </span>
                </div>
                {entry.detail && (
                  <p className="mt-0.5 break-words text-[11px] text-slate-500 [overflow-wrap:anywhere]">
                    {entry.detail}
                  </p>
                )}
                <WhyLine why={entry.why} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
