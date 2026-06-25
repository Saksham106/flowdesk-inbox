"use client"

import { createPortal } from "react-dom"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { WorkflowStatus } from "@/lib/workflow-status"

const WORKFLOW_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: "needs_reply", label: "Needs Reply", dot: "bg-red-500" },
  { value: "waiting_on",  label: "Waiting On",  dot: "bg-indigo-400" },
  { value: "read_later",  label: "Read Later",  dot: "bg-violet-400" },
  { value: "done",        label: "Done",        dot: "bg-emerald-500" },
]

type InboxRowProps = {
  id: string
  href: string
  isSelected: boolean
  /** Initial unread state — computed from readAt + gmailUnread in AppListColumn. Drives local optimistic state. */
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
  initialStatus: string
  isVip?: boolean
  vipLabel?: string | null
  onSnooze?: () => void
  snoozeUntil?: string | null
  attentionCategory: string | null
  isPersonal: boolean
  isGmail: boolean
  workflowStatus: WorkflowStatus
}

export default function InboxRow({
  id,
  href,
  isSelected,
  isUnread: initialIsUnread,
  name,
  snippet,
  timeLabel,
  statusDot,
  statusText,
  statusLabel,
  hasDraft,
  initialStatus,
  isVip,
  vipLabel,
  onSnooze,
  snoozeUntil,
  attentionCategory: initialAttention,
  isPersonal,
  isGmail,
  workflowStatus: initialWorkflowStatus,
}: InboxRowProps) {
  const router = useRouter()
  // Derive isRead from the pre-computed isUnread prop (considers readAt + gmailUnread).
  // FYI classification does not affect read state — an unread FYI is still visually unread.
  const [isRead, setIsRead]         = useState(!initialIsUnread)
  const [status, setStatus]         = useState(initialStatus)
  const [attention, setAttention]   = useState(initialAttention)
  const [workflowStatus, setWorkflowStatus] = useState(initialWorkflowStatus)
  const [showAttention, setShowAtt] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const attentionBtnRef             = useRef<HTMLButtonElement>(null)
  const portalRef                   = useRef<HTMLDivElement>(null)

  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<"read" | "status" | "archive" | "attention" | null>(null)
  const isUnread = !isRead
  const isClosed = workflowStatus === "done"

  // Close attention dropdown on outside click or any scroll (covers inbox list scroll)
  useEffect(() => {
    if (!showAttention) return
    function onOutside(e: MouseEvent) {
      const t = e.target as Node
      if (attentionBtnRef.current?.contains(t) || portalRef.current?.contains(t)) return
      setShowAtt(false)
    }
    function onScroll() { setShowAtt(false) }
    document.addEventListener("mousedown", onOutside)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [showAttention])

  async function toggleRead(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    const next = !isRead
    setIsRead(next)
    setPendingAction("read")
    const res = await fetch(`/api/conversations/${id}/read`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: next }),
    })
    if (!res.ok) setIsRead(!next)
    setPendingAction(null)
    router.refresh()
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    const nextStatus = isClosed ? "needs_reply" : "done"
    setWorkflowStatus(nextStatus as WorkflowStatus)
    setPendingAction("status")
    const res = await fetch(`/api/conversations/${id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: nextStatus }),
    })
    if (!res.ok) setWorkflowStatus(initialWorkflowStatus)
    setPendingAction(null)
    if (res.ok) router.refresh()
  }

  async function archiveConversation(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    setArchiveError(null)
    const prevStatus = status
    setStatus("closed")
    setPendingAction("archive")
    const res = await fetch(`/api/conversations/${id}/archive`, { method: "PATCH" })
    if (!res.ok) {
      setStatus(prevStatus)
      setArchiveError("Archive failed")
    }
    setPendingAction(null)
    if (res.ok) router.refresh()
  }

  function openAttentionDropdown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!showAttention && attentionBtnRef.current) {
      const rect = attentionBtnRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setShowAtt((v) => !v)
  }

  async function changeAttention(e: React.MouseEvent, cat: string) {
    e.preventDefault()
    e.stopPropagation()
    if (pendingAction) return
    setShowAtt(false)
    const prev = attention
    setAttention(cat)
    setWorkflowStatus(cat as WorkflowStatus)
    setPendingAction("attention")
    const res = await fetch(`/api/conversations/${id}/workflow-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowStatus: cat }),
    })
    if (!res.ok) { setAttention(prev); setWorkflowStatus(initialWorkflowStatus) }
    setPendingAction(null)
    if (res.ok) router.refresh()
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
                  : workflowStatus === "done"
                    ? "font-normal text-slate-500"
                    : "font-semibold text-slate-800"
              }`}
            >
              {name}
            </p>
            {isVip && (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                ⭐ {vipLabel ?? "VIP"}
              </span>
            )}
          </div>
          <span className={`shrink-0 text-[10px] ${isUnread ? "font-medium text-slate-600" : "text-slate-400"}`}>{timeLabel}</span>
        </div>
        {snippet && (
          <p className={`mt-0.5 truncate text-[11px] ${
            isUnread ? "text-slate-600" : workflowStatus === "done" ? "text-slate-400" : "text-slate-500"
          }`}>{snippet}</p>
        )}
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${statusText}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          {hasDraft && workflowStatus !== "done" && (
            <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
          )}
          {snoozeUntil && (
            <span className="text-xs text-indigo-500">
              💤 {new Date(snoozeUntil).toLocaleDateString()}
            </span>
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
          disabled={!!pendingAction}
          title={isRead ? "Mark unread" : "Mark read"}
          aria-label={isRead ? "Mark unread" : "Mark read"}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-wait"
        >
          {pendingAction === "read"
            ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
            : isRead
              ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-400" />
              : <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />}
        </button>

        {/* Attention / tag picker — dropdown rendered in a portal to escape the scroll container */}
        <button
          ref={attentionBtnRef}
          type="button"
          onClick={openAttentionDropdown}
          disabled={!!pendingAction}
          title="Change tag"
          aria-label="Change tag"
          aria-expanded={showAttention}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-wait"
        >
          {pendingAction === "attention"
            ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
            : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 1h4.5L11 6.5 6.5 11 1 5.5V1Z" />
                <circle cx="3.5" cy="3.5" r="0.75" fill="currentColor" stroke="none" />
              </svg>
            )}
        </button>
        {onSnooze && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSnooze() }}
            disabled={!!pendingAction}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-wait"
            title="Snooze"
          >
            💤
          </button>
        )}

        {/* Archive — Gmail only */}
        {isGmail && (
          <button
            type="button"
            onClick={archiveConversation}
            disabled={!!pendingAction}
            title={archiveError ?? "Archive"}
            aria-label="Archive"
            className={`flex h-6 w-6 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-wait ${
              archiveError
                ? "text-red-500 hover:bg-red-50"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {pendingAction === "archive"
              ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
              : (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="3" rx="0.5" />
                  <path d="M2 4v6.5h8V4" />
                  <path d="M4.5 6.5L6 8l1.5-1.5M6 8V5.5" />
                </svg>
              )}
          </button>
        )}

        {/* Done / Reopen — business accounts only */}
        {!isPersonal && (
          <button
            type="button"
            onClick={toggleStatus}
            disabled={!!pendingAction}
            title={isClosed ? "Reopen thread" : "Close thread"}
            aria-label={isClosed ? "Reopen thread" : "Close thread"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-wait"
          >
            {pendingAction === "status"
              ? <span className="inline-block h-2 w-2 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
              : isClosed ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 6A4 4 0 1 1 6 2" />
                  <path d="M4.5 3.5L6 2L7.5 3.5" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 6.5 5 9.5 10 3" />
                </svg>
              )}
          </button>
        )}
      </div>

      {/* Attention dropdown — portal into document.body so it escapes the inbox scroll container
          and is never covered by sibling rows' hover strips */}
      {showAttention && dropdownPos && typeof document !== "undefined" && createPortal(
        <div
          ref={portalRef}
          style={{ position: "fixed", top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999 }}
          className="min-w-[126px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {WORKFLOW_OPTIONS.map((opt) => (
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
        </div>,
        document.body
      )}
    </div>
  )
}
