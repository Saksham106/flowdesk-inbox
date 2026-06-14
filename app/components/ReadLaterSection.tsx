import Link from "next/link"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

const EMAIL_TYPE_LABEL: Record<string, string> = {
  newsletter: "Newsletter",
  notification: "Update",
  marketing: "Promo",
  fyi: "FYI",
}

interface Props {
  items: CommandCenterConversation[]
}

export default function ReadLaterSection({ items }: Props) {
  const preview = items.slice(0, 3)
  const overflow = items.length - preview.length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Read Later</p>
        {overflow > 0 && (
          <span className="text-[10px] text-blue-500">+{overflow} more</span>
        )}
      </div>
      {preview.length === 0 ? (
        <p className="text-[10px] text-slate-400 px-1">Nothing queued to read.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {preview.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-slate-700 truncate">{item.displayName}</p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.reason}</p>
                {item.emailType && (
                  <span className="inline-block mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                    {EMAIL_TYPE_LABEL[item.emailType] ?? item.emailType}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
                {relativeTime(item.lastMessageAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
