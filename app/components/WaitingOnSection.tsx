import Link from "next/link"
import type { CommandCenterConversation } from "@/lib/agent/command-center"
import { DEFAULT_FOLLOW_UP_BUSINESS_DAYS, followUpDueAt } from "@/lib/business-days"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

function followUpDueLabel(waitingSince: Date, staleAfterBusinessDays: number) {
  const due = followUpDueAt(waitingSince, staleAfterBusinessDays)
  const overdue = due.getTime() <= Date.now()
  return {
    overdue,
    text: overdue
      ? "Follow-up due"
      : `Follow-up ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  }
}

interface Props {
  items: CommandCenterConversation[]
  staleAfterBusinessDays?: number
}

export default function WaitingOnSection({
  items,
  staleAfterBusinessDays = DEFAULT_FOLLOW_UP_BUSINESS_DAYS,
}: Props) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        Waiting On
      </p>
      {items.length === 0 ? (
        <p className="text-[10px] text-slate-400 px-1">Not waiting on anyone.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 4).map((item) => {
            const due = followUpDueLabel(item.lastMessageAt, staleAfterBusinessDays)
            return (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-800 truncate">{item.displayName}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {relativeTime(item.lastMessageAt)}
                    {" · "}
                    <span className={due.overdue ? "text-amber-600 font-medium" : ""}>{due.text}</span>
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-blue-500 border border-blue-200 bg-blue-50 rounded-md px-2 py-0.5 flex-shrink-0 hover:bg-blue-100 transition">
                  Nudge →
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
