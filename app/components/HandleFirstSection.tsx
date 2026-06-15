"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { CommandCenterConversation, CommandCenterPriority } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

const PRIORITY_STYLES: Partial<Record<CommandCenterPriority, string>> = {
  urgent: "border-l-2 border-l-red-300 bg-red-50/40",
  high: "border-l-2 border-l-amber-300 bg-amber-50/40",
}

interface CardProps {
  item: CommandCenterConversation
}

function HandleFirstCard({ item }: CardProps) {
  const router = useRouter()
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [doneError, setDoneError] = useState<string | null>(null)

  if (done) return null

  async function handleDraftReply() {
    setDraftLoading(true)
    setDraftError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/draft/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Draft generation failed")
      }
      router.push(item.href)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to generate draft")
      setDraftLoading(false)
    }
  }

  async function handleMarkDone() {
    setDone(true) // optimistic
    try {
      const res = await fetch(`/api/conversations/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      })
      if (!res.ok) throw new Error("Failed to close")
    } catch {
      setDone(false)
      setDoneError("Couldn't mark as done")
    }
  }

  const priorityClass = PRIORITY_STYLES[item.priority] ?? ""
  const readClass = item.isRead ? "opacity-80" : "ring-1 ring-blue-100"

  function openCard() {
    router.push(item.href)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard()
    }
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${priorityClass} ${readClass}`}
      aria-label={`Open ${item.displayName}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-[12px] font-semibold text-slate-900 truncate">{item.displayName}</p>
        <span className="text-[10px] text-slate-400 flex-shrink-0">{relativeTime(item.lastMessageAt)}</span>
      </div>
      <p className="text-[11px] text-slate-600 truncate mb-1">{item.nextAction}</p>
      <p className="text-[10px] text-slate-400 italic mb-2.5">{item.reason}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {item.needsReply && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              handleDraftReply()
            }}
            disabled={draftLoading}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-60 hover:bg-blue-700 transition"
          >
            {draftLoading ? "Generating…" : "Draft Reply"}
          </button>
        )}
        {item.approvalReason && !item.needsReply && (
          <Link
            href={item.href}
            onClick={(event) => event.stopPropagation()}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Review Draft
          </Link>
        )}
        <Link
          href={item.href}
          onClick={(event) => event.stopPropagation()}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Open
        </Link>
        <button
          onClick={(event) => {
            event.stopPropagation()
            handleMarkDone()
          }}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Mark Done
        </button>
        {draftError && (
          <span className="text-[10px] text-red-500">{draftError}</span>
        )}
        {doneError && (
          <span className="text-[10px] text-red-500">{doneError}</span>
        )}
      </div>
    </div>
  )
}

interface Props {
  items: CommandCenterConversation[]
}

export default function HandleFirstSection({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center">
        <p className="text-[11px] font-medium text-slate-600">All caught up</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, 5).map((item) => (
        <HandleFirstCard key={item.id} item={item} />
      ))}
    </div>
  )
}
