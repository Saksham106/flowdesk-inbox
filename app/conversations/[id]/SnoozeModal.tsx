"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

const PRESETS = [
  { label: "1 hour", hours: 1 },
  { label: "Tomorrow 9am", hours: null, tomorrowMorning: true },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
]

function getTomorrowMorning() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

export default function SnoozeModal({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function snooze(until: Date) {
    setLoading(true)
    await fetch(`/api/conversations/${conversationId}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozeUntil: until.toISOString() }),
    })
    onClose()
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-72 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Snooze until…</h3>
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              disabled={loading}
              onClick={() => {
                const until = p.tomorrowMorning
                  ? getTomorrowMorning()
                  : new Date(Date.now() + (p.hours ?? 0) * 60 * 60 * 1000)
                snooze(until)
              }}
              className="w-full rounded-lg border border-slate-200 px-4 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full text-xs text-slate-400 hover:text-slate-600">
          Cancel
        </button>
      </div>
    </div>
  )
}
