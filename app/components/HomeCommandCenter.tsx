import Link from "next/link"

import HomeActionFeed from "@/app/components/HomeActionFeed"
import type { AgentSummary, QuietlyHandledBreakdown } from "@/lib/agent/command-center"
import type { GmailSyncChannel } from "@/lib/app-shell"
import type { HomeActionItem } from "@/lib/home-action-feed"

interface Props {
  date: Date
  metrics: { receivedToday: number; handledToday: number }
  feed: { items: HomeActionItem[]; total: number }
  agentSummary: AgentSummary
  quietlyHandledBreakdown: QuietlyHandledBreakdown
  gmailChannels: GmailSyncChannel[]
}

export default function HomeCommandCenter({
  date,
  metrics,
  feed,
  agentSummary,
  quietlyHandledBreakdown,
  gmailChannels,
}: Props) {
  const activity = activitySummary(agentSummary, quietlyHandledBreakdown)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Good morning</h1>
          <p className="mt-1 text-sm text-slate-500">
            {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Here’s what needs your attention.
          </p>
        </div>
        <SyncBadge channels={gmailChannels} />
      </header>

      <section aria-label="Today’s overview" className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Received today" value={metrics.receivedToday} />
        <Metric label="Handled by FlowDesk" value={metrics.handledToday} />
        <Metric label="Need you" value={feed.total} emphasized />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Your action items</h2>
            {feed.total > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{feed.total}</span>}
          </div>
          <Link href="/mail" className="text-xs font-medium text-blue-600 hover:underline">View all in Mail →</Link>
        </div>
        {feed.items.length > 0 ? (
          <HomeActionFeed items={feed.items} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-900">You’re caught up</p>
            <p className="mt-1 text-xs text-slate-500">FlowDesk will surface new decisions here when they need you.</p>
          </div>
        )}
      </section>

      {activity && (
        <details className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">What FlowDesk did today</summary>
          <p className="mt-2">{activity}</p>
          <Link href="/audit" className="mt-2 inline-block font-medium text-blue-600 hover:underline">Full activity log →</Link>
        </details>
      )}
    </div>
  )
}

function Metric({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${emphasized ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <p className={`text-2xl font-semibold ${emphasized ? "text-blue-700" : "text-slate-900"}`}>{value.toLocaleString()}</p>
      <p className={`text-xs ${emphasized ? "text-blue-600" : "text-slate-500"}`}>{label}</p>
    </div>
  )
}

function SyncBadge({ channels }: { channels: GmailSyncChannel[] }) {
  if (channels.length === 0) return <Link href="/settings/connect" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">Connect Gmail</Link>
  const latest = channels.reduce<Date | null>((best, channel) => !best || (channel.lastSyncedAt && channel.lastSyncedAt > best) ? channel.lastSyncedAt : best, null)
  const hasError = channels.some((channel) => channel.lastSyncError || channel.lastSyncStatus === "failed")
  if (hasError) return <Link href="/settings/connect" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">Gmail sync needs attention</Link>
  return <Link href="/settings/connect" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">● {latest ? `Gmail synced ${relativeAge(latest)}` : "Waiting for first sync"}</Link>
}

function relativeAge(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function activitySummary(summary: AgentSummary, breakdown: QuietlyHandledBreakdown) {
  const quiet = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  const parts = [
    summary.classifiedLast24h > 0 ? `Classified ${summary.classifiedLast24h} emails` : null,
    summary.draftedLast24h > 0 ? `prepared ${summary.draftedLast24h} drafts` : null,
    quiet > 0 ? `quietly handled ${quiet}` : null,
    summary.learnedRecentlyUpdated ? "learned from recent feedback" : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join(" · ")
}
