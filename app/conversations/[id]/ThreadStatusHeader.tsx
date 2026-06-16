"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { StatusBadge, LabelBadge } from "@/app/components/badges"

export default function ThreadStatusHeader({
  conversationId,
  initialStatus,
  displayName,
  channelAddress,
  label,
  isPersonal,
  isAutoEmail,
  isRead,
}: {
  conversationId: string
  initialStatus: string
  displayName: string
  channelAddress: string
  label: string | null
  isPersonal: boolean
  isAutoEmail: boolean
  isRead: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [optimisticRead, setOptimisticRead] = useState(isRead)
  const [loading, setLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)

  const displayStatus = isAutoEmail ? "closed" : status

  async function toggleStatus() {
    const nextStatus = status === "closed" ? "needs_reply" : "closed"
    setStatus(nextStatus)
    setLoading(true)
    try {
      await fetch(`/api/conversations/${conversationId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      router.refresh()
    } catch {
      setStatus(status)
    } finally {
      setLoading(false)
    }
  }

  async function toggleRead() {
    const nextRead = !optimisticRead
    setOptimisticRead(nextRead)
    setReadLoading(true)
    try {
      await fetch(`/api/conversations/${conversationId}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: nextRead }),
      })
      router.refresh()
    } catch {
      setOptimisticRead(!nextRead)
    } finally {
      setReadLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 truncate text-base font-bold text-slate-900">{displayName}</h1>
          <StatusBadge status={displayStatus} />
          {label && !isPersonal && <LabelBadge label={label} />}
        </div>
        <p className="min-w-0 break-all text-xs text-slate-500">{channelAddress}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={toggleRead}
          disabled={readLoading}
          title={optimisticRead ? "Mark as unread" : "Mark as read"}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {optimisticRead ? "Mark unread" : "Mark read"}
        </button>
        {!isPersonal && (
          <button
            onClick={toggleStatus}
            disabled={loading}
            title={status === "closed" ? "Reopen thread" : "Close thread"}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "…" : status === "closed" ? "Reopen" : "Close"}
          </button>
        )}
      </div>
    </div>
  )
}
