"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

type InboxRowProps = {
  id: string
  href: string
  isSelected: boolean
  isUnread: boolean
  isFyi: boolean
  isClosed: boolean
  name: string
  snippet: string
  timeLabel: string
  statusDot: string
  statusText: string
  statusLabel: string
  hasDraft: boolean
  initialReadAt: boolean
  initialStatus: string
}

export default function InboxRow({
  id,
  href,
  isSelected,
  isFyi,
  name,
  snippet,
  timeLabel,
  statusDot,
  statusText,
  statusLabel,
  hasDraft,
  initialReadAt,
  initialStatus,
}: InboxRowProps) {
  const router = useRouter()
  const [isRead, setIsRead] = useState(initialReadAt)
  const [status, setStatus] = useState(initialStatus)

  const isUnread = !isRead && !isFyi
  const isClosed = status === "closed"

  async function toggleRead(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nextRead = !isRead
    setIsRead(nextRead)
    const res = await fetch(`/api/conversations/${id}/read`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: nextRead }),
    })
    if (!res.ok) setIsRead(!nextRead)
    router.refresh()
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nextStatus = isClosed ? "needs_reply" : "closed"
    setStatus(nextStatus)
    const res = await fetch(`/api/conversations/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (!res.ok) setStatus(status)
    router.refresh()
  }

  return (
    <div className="group relative">
      <Link
        href={href}
        className={`block border-b border-slate-50 px-3 py-2.5 transition ${
          isSelected
            ? "border-l-2 border-l-blue-500 bg-blue-50"
            : isUnread
              ? "hover:bg-blue-50/60"
              : "hover:bg-slate-50"
        }`}
      >
        <div className="flex items-baseline justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {isUnread && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
            )}
            <p
              className={`min-w-0 truncate text-xs ${
                isUnread
                  ? "font-bold text-slate-900"
                  : isFyi || isClosed
                    ? "font-normal text-slate-500"
                    : "font-semibold text-slate-800"
              }`}
            >
              {name}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-slate-400">{timeLabel}</span>
        </div>
        {snippet && (
          <p className={`mt-0.5 truncate text-[11px] ${
            isUnread ? "text-slate-600" : isFyi || isClosed ? "text-slate-400" : "text-slate-500"
          }`}>{snippet}</p>
        )}
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${statusText}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          {hasDraft && !isFyi && (
            <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
          )}
        </div>
      </Link>

      {/* Hover action strip — CSS-driven to avoid dismount race on fast mouse exits */}
      <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
        <button
          type="button"
          onClick={toggleRead}
          title={isRead ? "Mark unread" : "Mark read"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {isRead ? (
            <span className="h-2 w-2 rounded-full border-2 border-slate-400 inline-block" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" />
          )}
        </button>
        <button
          type="button"
          onClick={toggleStatus}
          title={isClosed ? "Reopen" : "Close"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {isClosed ? "↺" : "✓"}
        </button>
      </div>
    </div>
  )
}
