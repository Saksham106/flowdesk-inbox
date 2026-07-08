import Link from "next/link"
import { buildControlRoomStatus } from "@/lib/control-room-status"

interface Props {
  /** Current automation level (0-5). */
  automationLevel: number
  /** Items awaiting a human decision (drafts + actions). */
  pendingReview: number
  /** Whether the tenant has a connected Gmail account (gates the Open Gmail CTA). */
  hasGmail: boolean
  date: Date
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

/**
 * The control-room identity header: a live "what the agent is doing" status
 * line plus a prominent hand-off back to Gmail (the daily workspace). Replaces
 * the old "Good morning" greeting to reframe the app as a supervision surface,
 * not a second inbox.
 */
export default function ControlRoomHeader({
  automationLevel,
  pendingReview,
  hasGmail,
  date,
}: Props) {
  const status = buildControlRoomStatus({ level: automationLevel, pendingReview, hasGmail })

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${hasGmail ? "bg-green-400" : "bg-amber-400"}`}
            aria-hidden
          />
          <p className="text-sm font-semibold text-slate-900">Control room</p>
          <span className="text-[11px] text-slate-400">{dateLabel(date)}</span>
        </div>
        <Link
          href={hasGmail ? "/settings#automation" : "/settings#connect"}
          className="mt-1 block text-xs text-slate-500 break-words [overflow-wrap:anywhere] hover:text-slate-700 hover:underline"
          title={hasGmail ? "Change how much FlowDesk can do on its own" : "Connect your Gmail account"}
        >
          {status}
        </Link>
      </div>
      {hasGmail ? (
        <a
          href="https://mail.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5m0-5L10 14M9 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4" />
          </svg>
          Open Gmail
        </a>
      ) : (
        <Link
          href="/settings#connect"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Connect Gmail
        </Link>
      )}
    </div>
  )
}
