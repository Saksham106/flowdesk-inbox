"use client"

import { useEffect, useRef, useState } from "react"
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
  isGmail,
}: {
  conversationId: string
  initialStatus: string
  displayName: string
  channelAddress: string
  label: string | null
  isPersonal: boolean
  isAutoEmail: boolean
  isRead: boolean
  isGmail: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [optimisticRead, setOptimisticRead] = useState(isRead)
  const [loading, setLoading] = useState(false)
  const [readLoading, setReadLoading] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashError, setTrashError] = useState<string | null>(null)
  const [showTrashConfirm, setShowTrashConfirm] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const displayStatus = isAutoEmail ? "closed" : status

  // Close More menu on outside click
  useEffect(() => {
    if (!showMore) return
    function onOutside(e: MouseEvent) {
      if (moreRef.current?.contains(e.target as Node)) return
      setShowMore(false)
      setShowTrashConfirm(false)
    }
    document.addEventListener("mousedown", onOutside)
    return () => document.removeEventListener("mousedown", onOutside)
  }, [showMore])

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

  async function archive() {
    setArchiveError(null)
    setArchiveLoading(true)
    const prevStatus = status
    setStatus("closed")
    try {
      const res = await fetch(`/api/conversations/${conversationId}/archive`, { method: "PATCH" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setArchiveError((body as { error?: string }).error ?? "Archive failed")
        setStatus(prevStatus)
      } else {
        router.refresh()
      }
    } catch {
      setArchiveError("Archive failed")
      setStatus(prevStatus)
    } finally {
      setArchiveLoading(false)
    }
  }

  async function trash() {
    setTrashError(null)
    setTrashLoading(true)
    setShowMore(false)
    setShowTrashConfirm(false)
    const prevStatus = status
    setStatus("closed")
    try {
      const res = await fetch(`/api/conversations/${conversationId}/trash`, { method: "PATCH" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setTrashError((body as { error?: string }).error ?? "Move to trash failed")
        setStatus(prevStatus)
      } else {
        router.refresh()
      }
    } catch {
      setTrashError("Move to trash failed")
      setStatus(prevStatus)
    } finally {
      setTrashLoading(false)
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
        {archiveError && (
          <span className="text-xs text-red-500">{archiveError}</span>
        )}
        {trashError && (
          <span className="text-xs text-red-500">{trashError}</span>
        )}
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
        {isGmail && (
          <button
            onClick={archive}
            disabled={archiveLoading}
            title="Archive (removes from inbox)"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {archiveLoading ? "…" : "Archive"}
          </button>
        )}
        {isGmail && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => { setShowMore((v) => !v); setShowTrashConfirm(false) }}
              disabled={trashLoading}
              title="More actions"
              aria-label="More actions"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {trashLoading ? "…" : "···"}
            </button>
            {showMore && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {showTrashConfirm ? (
                  <div className="px-3 py-2">
                    <p className="mb-2 text-xs text-slate-700">Move to trash?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={trash}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Move to trash
                      </button>
                      <button
                        onClick={() => setShowTrashConfirm(false)}
                        className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTrashConfirm(true)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Move to trash
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
