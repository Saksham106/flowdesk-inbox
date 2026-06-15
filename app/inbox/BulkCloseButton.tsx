"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function BulkCloseButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (!confirm("Archive all safely-ignored (quiet / FYI done) conversations?")) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/conversations/bulk-close", { method: "POST" })
      if (!res.ok) {
        setError("Failed to archive conversations")
        return
      }
      const data = await res.json()
      setResult(data.closed ?? 0)
      router.refresh()
    } catch {
      setError("Failed to archive conversations")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Archiving…" : "Archive all safely ignored"}
      </button>
      {result !== null && (
        <p className="text-xs text-slate-500">{result} conversation{result !== 1 ? "s" : ""} archived.</p>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
