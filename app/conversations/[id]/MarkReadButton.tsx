"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function MarkReadButton({
  conversationId,
  isRead,
}: {
  conversationId: string
  isRead: boolean
}) {
  const router = useRouter()
  const [optimisticRead, setOptimisticRead] = useState(isRead)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const nextRead = !optimisticRead
    setOptimisticRead(nextRead)
    setLoading(true)
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
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={optimisticRead ? "Mark as unread" : "Mark as read"}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {optimisticRead ? "Mark unread" : "Mark read"}
    </button>
  )
}
