"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function UnsubscribeButton({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleUnsubscribe() {
    if (!confirm("Unsubscribe and archive this conversation?")) return
    setLoading(true)
    await fetch(`/api/conversations/${conversationId}/unsubscribe`, { method: "POST" })
    setDone(true)
    router.refresh()
  }

  if (done) return <span className="text-xs text-slate-400">Unsubscribed ✓</span>

  return (
    <button
      onClick={handleUnsubscribe}
      disabled={loading}
      className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "Unsubscribing…" : "Unsubscribe & Archive"}
    </button>
  )
}
