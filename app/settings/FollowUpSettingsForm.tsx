"use client"

import { useState } from "react"

type FollowUpSettingSnapshot = {
  enabled: boolean
  staleAfterDays: number
  maxFollowUpsPerConversation: number
} | null

export default function FollowUpSettingsForm({
  initial,
}: {
  initial: FollowUpSettingSnapshot
}) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [staleAfterDays, setStaleAfterDays] = useState(
    String(initial?.staleAfterDays ?? 3)
  )
  const [maxFollowUps, setMaxFollowUps] = useState(
    String(initial?.maxFollowUpsPerConversation ?? 2)
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/follow-up-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          staleAfterDays: parseInt(staleAfterDays, 10),
          maxFollowUpsPerConversation: parseInt(maxFollowUps, 10),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Enable follow-up automation</p>
          <p className="text-xs text-slate-500">
            Automatically surface quiet conversations for follow-up.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? "bg-slate-900" : "bg-slate-300"
          }`}
          aria-pressed={enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
          <div>
            <label className="text-xs font-medium text-slate-600">
              Mark conversation stale after (days)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={staleAfterDays}
              onChange={(e) => setStaleAfterDays(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">
              Max follow-ups per conversation
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxFollowUps}
              onChange={(e) => setMaxFollowUps(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-green-600">Saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  )
}
