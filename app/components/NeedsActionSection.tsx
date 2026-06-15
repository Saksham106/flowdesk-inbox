import Link from "next/link"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

interface Props {
  items: CommandCenterConversation[]
}

export default function NeedsActionSection({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
          Needs Action
        </p>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
          OTPs · Links · Security
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 hover:bg-amber-50 transition ${item.isRead ? "opacity-80" : "ring-1 ring-amber-200"}`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-amber-900">{item.displayName}</p>
              <p className="text-[11px] text-amber-800 truncate">{item.nextAction}</p>
              <p className="text-[10px] text-amber-600 italic mt-0.5">{item.reason}</p>
            </div>
            <span className="text-[10px] font-semibold text-amber-700 flex-shrink-0">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
