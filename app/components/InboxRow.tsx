"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

type AttentionOption = { value: string; label: string; dot: string }

const ATTENTION_OPTIONS: AttentionOption[] = [
  { value: "needs_reply", label: "Reply needed", dot: "bg-red-500" },
  { value: "read_later",  label: "Read later",   dot: "bg-violet-400" },
  { value: "fyi_done",    label: "FYI / Done",   dot: "bg-emerald-500" },
  { value: "quiet",       label: "Quiet",        dot: "bg-slate-300" },
]

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
  attentionCategory: string | null
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
  attentionCategory: initialAttention,
}: InboxRowProps) {
  const router = useRouter()
  const [isRead, setIsRead]           = useState(initialReadAt)
  const [status, setStatus]           = useState(initialStatus)
  const [attention, setAttention]     = useState(initialAttention)
  const [showAttention, setShowAtt]   = useState(false)
  const attentionRef                  = useRef<HTMLDivElement>(null)

  const isUnread = !isRead && !isFyi
  const isClosed = status === "closed"

  // Close the attention dropdown when the user clicks outside it
  useEffect(() => {
    if (!showAttention) return
    function onOutside(e: MouseEvent) {
      if (attentionRef.current && !attentionRef.current.contains(e.target as Node)) {
        setShowAtt(false)
      }
    }
    document.addEventListener("mousedown", onOutside)
    return () => document.removeEventListener("mousedown", onOutside)
  }, [showAttention])

  async function toggleRead(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isRead
    setIsRead(next)
    const res = await fetch(`/api/conversations/${id}/read`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: next }),
    })
    if (!res.ok) setIsRead(!next)
    router.refresh()
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = isClosed ? "needs_reply" : "closed"
    setStatus(next)
    const res = await fetch(`/api/conversations/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    })
    if (!res.ok) setStatus(status)
    router.refresh()
  }

  async function changeAttention(e: React.MouseEvent, cat: string) {
    e.preventDefault()
    e.stopPropagation()
    setShowAtt(false)
    const prev = attention
    setAttention(cat)
    const res = await fetch(`/api/conversations/${id}/attention`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attentionCategory: cat }),
    })
    if (!res.ok) setAttention(prev)
    else router.refresh()
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

      {/* Hover action strip — CSS-driven; stays visible while attention dropdown is open */}
      <div
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-sm transition-opacity ${
          showAttention
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto"
        }`}
      >
        {/* Read / Unread */}
        <button
          type="button"
          onClick={toggleRead}
          title={isRead ? "Mark unread" : "Mark read"}
          aria-label={isRead ? "Mark unread" : "Mark read"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isRead
            ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-400" />
            : <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />}
        </button>

        {/* Attention / tag picker */}
        <div ref={attentionRef} className="relative">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAtt((v) => !v) }}
            title="Change tag"
            aria-label="Change tag"
            aria-expanded={showAttention}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {/* Tag icon */}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 1h4.5L11 6.5 6.5 11 1 5.5V1Z" />
              <circle cx="3.5" cy="3.5" r="0.75" fill="currentColor" stroke="none" />
            </svg>
          </button>

          {showAttention && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[126px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {ATTENTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => changeAttention(e, opt.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-slate-50 focus:outline-none ${
                    attention === opt.value ? "font-semibold text-slate-900" : "text-slate-700"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${opt.dot}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Done / Reopen */}
        <button
          type="button"
          onClick={toggleStatus}
          title={isClosed ? "Reopen" : "Done"}
          aria-label={isClosed ? "Reopen" : "Done"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isClosed
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 6A4 4 0 1 1 6 2M10 2v4H6" /></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" /></svg>}
        </button>
      </div>
    </div>
  )
}
