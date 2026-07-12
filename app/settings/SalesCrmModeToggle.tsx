"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function SalesCrmModeToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (saving) return
    const next = !on
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings/sales-crm-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? "Could not update Sales & CRM mode.")
      }
      setOn(next)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Sales & CRM mode.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">Sales &amp; CRM mode</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Turn on lead scoring, sales and support signals, revenue-at-risk, weekly reports, meeting
          prep, and business-tone drafting. Off by default — most people don&apos;t need it.
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={saving}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
          on ? "bg-[var(--color-accent)]" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  )
}
