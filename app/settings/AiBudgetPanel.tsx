"use client"

import { useState } from "react"

type BudgetStatus = {
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dailyLimitUsd: number
  monthlyLimitUsd: number
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isWarning = pct >= 75
  const isCritical = pct >= 95
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${
          isCritical ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-emerald-500"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function AiBudgetPanel({ initial }: { initial: BudgetStatus }) {
  const [status, setStatus] = useState(initial)
  const [dailyLimit, setDailyLimit] = useState(String(initial.dailyLimitUsd))
  const [monthlyLimit, setMonthlyLimit] = useState(String(initial.monthlyLimitUsd))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const daily = parseFloat(dailyLimit)
    const monthly = parseFloat(monthlyLimit)
    if (isNaN(daily) || daily < 0 || isNaN(monthly) || monthly < 0) {
      setError("Limits must be non-negative numbers.")
      return
    }
    if (daily > monthly) {
      setError("Daily limit cannot exceed monthly limit.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings/ai-budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimitUsd: daily, monthlyLimitUsd: monthly }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save limits.")
      } else {
        setStatus(data)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {
      setError("Network error — please try again.")
    } finally {
      setSaving(false)
    }
  }

  const fmt = (n: number) => `$${n.toFixed(4)}`
  const fmtLimit = (n: number) => `$${n.toFixed(2)}`

  return (
    <div className="space-y-5">
      {/* Usage */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Today</span>
            <span className="font-medium tabular-nums text-slate-800">
              {fmt(status.dailyUsedUsd)} / {fmtLimit(status.dailyLimitUsd)}
            </span>
          </div>
          <UsageBar used={status.dailyUsedUsd} limit={status.dailyLimitUsd} />
        </div>
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">This month</span>
            <span className="font-medium tabular-nums text-slate-800">
              {fmt(status.monthlyUsedUsd)} / {fmtLimit(status.monthlyLimitUsd)}
            </span>
          </div>
          <UsageBar used={status.monthlyUsedUsd} limit={status.monthlyLimitUsd} />
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Costs are estimated from token counts using conservative model pricing. AI calls that would exceed a
        limit are blocked with an error. Resets: daily at midnight UTC, monthly on the 1st.
      </p>

      {/* Limit editor */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Daily limit (USD)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Monthly limit (USD)</label>
          <input
            type="number"
            min="0"
            step="1"
            value={monthlyLimit}
            onChange={(e) => setMonthlyLimit(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save limits"}
      </button>
    </div>
  )
}
