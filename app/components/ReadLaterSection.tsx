"use client"

import { useState, useRef, useEffect } from "react"
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
  const [doneState, setDoneState] = useState<"idle" | "undoable" | "done">("idle")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  if (doneState === "done") return null

  async function markDone(e: React.MouseEvent, withUndo: boolean) {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "done" }),
      })
      if (!res.ok) throw new Error()
      if (withUndo) {
        setDoneState("undoable")
        undoTimerRef.current = setTimeout(() => {
          setDoneState("done")
          router.refresh()
        }, 5000)
      } else {
        setDoneState("done")
        router.refresh()
      }
    } catch {
      setError("Couldn't update")
    } finally {
      setLoading(false)
    }
  }

  function handleUndo(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setDoneState("idle")
    fetch(`/api/conversations/${item.id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: "read_later" }),
    })
  }

  if (doneState === "undoable") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <span className="text-[11px] text-slate-500">Marked as done · </span>
        <button
          onClick={handleUndo}
          className="text-[10px] font-semibold text-blue-600 hover:underline"
        >
          Undo
        </button>
      </div>
    )
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
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          {error && <span className="text-[9px] text-red-500 self-center mr-1">{error}</span>}
          <button
            type="button"
            onClick={(e) => markDone(e, true)}
            disabled={loading}
            className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100 disabled:opacity-40 disabled:cursor-wait"
          >
            {loading ? "…" : "Done"}
          </button>
          <button
            type="button"
            onClick={(e) => markDone(e, false)}
            disabled={loading}
            className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100 disabled:opacity-40 disabled:cursor-wait"
          >
            {loading ? "…" : "Not interested"}
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
          <a href="/inbox?attention=read_later" className="text-[10px] text-blue-500 hover:underline">
            +{overflow} more
          </a>
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
