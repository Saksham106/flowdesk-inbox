"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const CATEGORY_LABELS: Record<string, string> = {
  needs_reply: "Needs Reply",
  needs_action: "Needs Action",
  review_soon: "Review Soon",
  read_later: "Read Later",
  waiting_on: "Waiting On",
  fyi_done: "FYI / Done",
  quiet: "Quiet",
}

export default function AttentionCorrectionSelect({
  conversationId,
  current,
}: {
  conversationId: string
  current?: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState(current ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelected(current ?? "")
  }, [current])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (!value) return
    const previous = selected
    setSelected(value)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/attention`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attentionCategory: value }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setSelected(previous)
        setError("Failed to update")
      }
    } catch {
      setSelected(previous)
      setError("Failed to update")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <label className="text-xs text-slate-500">Attention</label>
      <select
        value={selected}
        onChange={handleChange}
        disabled={saving}
        className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
      >
        <option value="">— not set —</option>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
