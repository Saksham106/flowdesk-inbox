import Link from "next/link"
import type { DailyCommandCenter, CommandCenterConversation } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

function ctaLabel(item: CommandCenterConversation): string {
  if (item.approvalReason) return "Review draft →"
  if (item.state === "risky_urgent") return "Urgent →"
  if (item.needsReply) return "Reply →"
  if (item.opportunity) return "Respond →"
  return "Open →"
}

interface FollowUp {
  id: string
  displayName: string
  scheduledAt: Date
  href: string
}

interface IgnoredItem {
  id: string
  displayName: string
  reason: string | null
  href: string
}

interface Props {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
  followUps: FollowUp[]
  ignoredItems: IgnoredItem[]
  accountType: string | null
  date: Date
}

export default function HomeCommandCenter({
  commandCenter,
  revenueAtRisk,
  followUps,
  ignoredItems,
  accountType,
  date,
}: Props) {
  const isBusiness = accountType === "business"
  const { counts, topActions, headline } = commandCenter

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  const headerStats = [
    { label: "Reply", value: counts.needsReply },
    { label: "Review", value: counts.approvals },
    { label: "Waiting", value: counts.waitingOnThem },
    { label: "Quiet", value: counts.safelyIgnored },
    ...(isBusiness ? [{ label: "Sales", value: counts.salesQualified }] : []),
  ]

  return (
    // Full-width, split into two columns on large screens
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-5xl">
        {/* Dark gradient header — full width */}
        <div className="mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 px-6 py-5 text-white shadow-md">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {dateLabel}
          </p>
          <h1 className="mb-4 text-2xl font-bold leading-snug">{headline}</h1>
          <div className="flex flex-wrap gap-3">
            {headerStats.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg bg-white/10 px-4 py-2.5 text-center min-w-[64px]"
              >
                <p className="text-xl font-extrabold leading-none">{value}</p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-300">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          {/* Left: main action items */}
          <div className="min-w-0 space-y-5">
            {/* Business: Revenue at Risk */}
            {isBusiness && revenueAtRisk.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-600">
                  Revenue at Risk
                </p>
                <div className="space-y-2">
                  {revenueAtRisk.map((item) => (
                    <Link
                      key={item.conversationId}
                      href={`/conversations/${item.conversationId}`}
                      className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 transition hover:bg-amber-100"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.contactName}</p>
                        <p className="text-xs text-amber-700">
                          No reply in {item.daysSinceLastMessage} day{item.daysSinceLastMessage === 1 ? "" : "s"}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-emerald-700">
                        ${item.estimatedValue.toLocaleString()}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Handle first */}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                Handle first
              </p>
              {topActions.length > 0 ? (
                <div className="space-y-2">
                  {topActions.slice(0, 8).map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`block rounded-xl border px-4 py-3 transition ${
                        item.priority === "urgent" || item.priority === "high"
                          ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-bold text-slate-900">{item.displayName}</p>
                        <span className="shrink-0 text-xs text-slate-400">
                          {relativeTime(item.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">{item.reason}</p>
                      <p className="mt-1.5 text-xs font-semibold text-blue-600">{ctaLabel(item)}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
                  <p className="text-sm font-semibold text-slate-700">You&apos;re all caught up</p>
                  <p className="mt-1 text-xs text-slate-500">Nothing needs attention right now.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: follow-ups + ignored */}
          <div className="min-w-0 space-y-3">
            {followUps.length > 0 && (
              <details open className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
                <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold uppercase tracking-wide text-amber-700 hover:bg-amber-100">
                  Follow-ups queued ({followUps.length})
                </summary>
                <ul className="divide-y divide-amber-100 border-t border-amber-100">
                  {followUps.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={c.href}
                        className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-amber-100"
                      >
                        <span className="font-medium text-amber-900">{c.displayName}</span>
                        <span className="text-xs text-amber-600">
                          {c.scheduledAt.toLocaleDateString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {ignoredItems.length > 0 && (
              <details className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
                  Safely ignored ({ignoredItems.length})
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {ignoredItems.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={c.href}
                        className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-700">{c.displayName}</span>
                        {c.reason && (
                          <span className="shrink-0 text-xs text-slate-400">{c.reason}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {followUps.length === 0 && ignoredItems.length === 0 && (
              <div className="rounded-xl border border-slate-100 bg-white px-4 py-6 text-center">
                <p className="text-xs text-slate-400">No follow-ups or snoozed items</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
