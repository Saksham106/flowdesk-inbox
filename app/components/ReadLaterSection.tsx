"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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

interface CardProps {
  item: CommandCenterConversation
}

function ReadLaterCard({ item }: CardProps) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  async function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissed(true)
    setError(null)
    const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: "done" }),
    })
    if (!res.ok) {
      setDismissed(false)
      setError("Couldn't update")
    } else {
      router.refresh()
    }
  }

  return (
    <div className="group relative flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition">
      <a href={item.href} className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-700 truncate">{item.displayName}</p>
        <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.reason}</p>
        {item.emailType && (
          <span className="inline-block mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
            {EMAIL_TYPE_LABEL[item.emailType] ?? item.emailType}
          </span>
        )}
      </a>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] text-slate-400 mt-0.5">{relativeTime(item.lastMessageAt)}</span>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          {error && <span className="text-[9px] text-red-500 self-center mr-1">{error}</span>}
          <button
            type="button"
            onClick={(e) => handleDismiss(e)}
            title="Mark as FYI / Done"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Mark as FYI / Done"
          >
            {/* checkmark */}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 6.5 5 9.5 10 3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => handleDismiss(e)}
            title="Mark as Quiet"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Mark as Quiet"
          >
            {/* mute / x icon */}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
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
            <ReadLaterCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
