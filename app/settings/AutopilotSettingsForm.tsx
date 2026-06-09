"use client"

import { useState } from "react"

const INTENT_OPTIONS = ["FAQ", "Lead", "Reschedule", "Pricing", "Complaint"]

type AutopilotSnapshot = {
  enabled: boolean
  confidenceThreshold: number
  allowedIntents: string[]
  maxAutoSendsPerDay: number
  disableAfterFailures: number
  currentFailures: number
  disabledAt: string | null
} | null

export default function AutopilotSettingsForm({ initial }: { initial: AutopilotSnapshot }) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [threshold, setThreshold] = useState(String(initial?.confidenceThreshold ?? 0.85))
  const [allowedIntents, setAllowedIntents] = useState<string[]>(initial?.allowedIntents ?? [])
  const [maxSends, setMaxSends] = useState(String(initial?.maxAutoSendsPerDay ?? 10))
  const [disableAfter, setDisableAfter] = useState(String(initial?.disableAfterFailures ?? 3))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDisabled = !!initial?.disabledAt
  const currentFailures = initial?.currentFailures ?? 0

  function toggleIntent(intent: string) {
    setAllowedIntents((prev) =>
      prev.includes(intent) ? prev.filter((i) => i !== intent) : [...prev, intent]
    )
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/autopilot-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          confidenceThreshold: parseFloat(threshold),
          allowedIntents,
          maxAutoSendsPerDay: parseInt(maxSends, 10),
          disableAfterFailures: parseInt(disableAfter, 10),
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

  async function handleReset() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/autopilot-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetFailures: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to reset")
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset")
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {isDisabled && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Autopilot disabled after {initial?.disableAfterFailures} consecutive failures.</p>
          <p className="mt-1 text-xs">Fix the root cause before re-enabling.</p>
          <button
            onClick={handleReset}
            disabled={saving}
            className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            Reset failure count &amp; re-enable
          </button>
        </div>
      )}

      {!isDisabled && currentFailures > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {currentFailures} consecutive failure{currentFailures !== 1 ? "s" : ""} — will auto-disable after {initial?.disableAfterFailures}.
        </div>
      )}

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Enable autopilot</p>
          <p className="text-xs text-slate-500">
            AI sends replies automatically when all safety conditions are met.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          disabled={isDisabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${
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

      {/* Warning */}
      {enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Autopilot will send emails without staff review. Only enable for workflows you have fully validated.
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
        {/* Confidence threshold */}
        <div>
          <label className="text-xs font-medium text-slate-600">
            Minimum confidence threshold (0.5 – 1.0)
          </label>
          <input
            type="number"
            step={0.05}
            min={0.5}
            max={1.0}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <p className="mt-0.5 text-xs text-slate-400">
            Replies are only sent automatically when the AI&apos;s confidence is at least this high.
          </p>
        </div>

        {/* Allowed intents */}
        <div>
          <p className="text-xs font-medium text-slate-600">Allowed intents (leave empty to allow all)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {INTENT_OPTIONS.map((intent) => (
              <button
                key={intent}
                type="button"
                onClick={() => toggleIntent(intent)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  allowedIntents.includes(intent)
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {intent}
              </button>
            ))}
          </div>
        </div>

        {/* Max auto-sends per day */}
        <div>
          <label className="text-xs font-medium text-slate-600">Max auto-sends per day</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxSends}
            onChange={(e) => setMaxSends(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Disable after failures */}
        <div>
          <label className="text-xs font-medium text-slate-600">Auto-disable after N consecutive failures</label>
          <input
            type="number"
            min={1}
            max={20}
            value={disableAfter}
            onChange={(e) => setDisableAfter(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

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
