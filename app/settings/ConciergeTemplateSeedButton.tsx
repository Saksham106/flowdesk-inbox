"use client"

import { useState } from "react"

export default function ConciergeTemplateSeedButton({ alreadySeeded }: { alreadySeeded: boolean }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(alreadySeeded)
  const [error, setError] = useState<string | null>(null)

  async function handleSeed() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/settings/seed-templates", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed templates")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return <p className="text-xs text-green-600">Concierge templates are loaded. Find them in Knowledge Base.</p>
  }

  return (
    <div>
      <p className="text-sm text-slate-600">
        Pre-built reply templates for pricing, scheduling, complaints, onboarding, and follow-ups.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <button
        onClick={handleSeed}
        disabled={loading}
        className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? "Loading…" : "Load 8 concierge templates"}
      </button>
    </div>
  )
}
