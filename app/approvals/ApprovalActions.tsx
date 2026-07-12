"use client"

import { useState } from "react"

export default function ApprovalActions({
  approvalId,
  onDecided,
}: {
  approvalId: string
  onDecided: (id: string) => void
}) {
  const [loading, setLoading] = useState<"approved" | "rejected" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: "approved" | "rejected") {
    setLoading(decision)
    setError(null)
    try {
      const res = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      })
      if (!res.ok) {
        setError("Could not save")
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.sendError) {
        // Decision saved but the reply did not go out — keep the row visible
        // so the reviewer sees why instead of the item silently vanishing.
        setError(data.sendError)
        return
      }
      onDecided(approvalId)
    } catch {
      setError("Could not save")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => decide("approved")}
          disabled={loading !== null}
          className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
        >
          {loading === "approved" ? "…" : "Approve"}
        </button>
        <button
          onClick={() => decide("rejected")}
          disabled={loading !== null}
          className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
        >
          {loading === "rejected" ? "…" : "Reject"}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
