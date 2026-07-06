"use client"

import { useState } from "react"

const CATEGORY_OPTIONS = [
  { key: "needs_reply", label: "Reply needed" },
  { key: "needs_action", label: "Needs action" },
  { key: "review_soon", label: "Review soon" },
  { key: "read_later", label: "Read later" },
  { key: "waiting_on", label: "Waiting On" },
  { key: "fyi_done", label: "FYI / Done" },
  { key: "quiet", label: "Quiet" },
]

type CategoryPolicy = { action: "auto_send" | "require_approval" | "never"; threshold?: number }

type RawCategoryPolicy = { action: string; threshold?: number }

type AutopilotSnapshot = {
  automationLevel: number
  enabled: boolean
  confidenceThreshold: number
  maxAutoSendsPerDay: number
  disableAfterFailures: number
  currentFailures: number
  disabledAt: string | null
  categoryThresholds: Record<string, RawCategoryPolicy | number>
} | null

const AUTOMATION_LEVELS = [
  {
    level: 0,
    name: "Observe only",
    does: "Reads and analyzes your email so the dashboard stays informed.",
    wont: "Won't touch your Gmail at all — no labels, no drafts, never sends.",
  },
  {
    level: 1,
    name: "Suggest in dashboard",
    does: "Shows suggested labels and reply drafts inside FlowDesk.",
    wont: "Won't change anything in Gmail — suggestions stay in the dashboard, never sends.",
  },
  {
    level: 2,
    name: "Organize Gmail",
    does: "Applies FlowDesk labels in your Gmail so the inbox arrives sorted.",
    wont: "Won't create drafts in Gmail, mark anything read, or send anything.",
  },
  {
    level: 3,
    name: "Draft in Gmail",
    does: "Labels your inbox and leaves suggested replies in your Gmail drafts folder.",
    wont: "Won't send anything — you always review and press Send yourself.",
  },
  {
    level: 4,
    name: "Light autopilot",
    does: "Labels, drafts, and may mark clearly low-risk email read or archive safe categories.",
    wont: "Won't send replies on your behalf.",
  },
  {
    level: 5,
    name: "Auto-send (restricted)",
    does: "May auto-send replies, but only for tightly approved categories that also pass every confidence, policy, and budget check.",
    wont: "Won't send anything risky, sensitive, or low-confidence — those still wait for your approval.",
  },
] as const

export default function AutopilotSettingsForm({
  initial,
  requiresLearnedProfile = false,
  hasLearnedProfile = true,
}: {
  initial: AutopilotSnapshot
  requiresLearnedProfile?: boolean
  hasLearnedProfile?: boolean
}) {
  // A tenant without a settings row predates the ladder: legacy default is
  // Level 3 (labels + Gmail drafts, what shipped in Phases A/B), matching
  // getAutomationLevel's server-side fallback.
  const [currentLevel, setCurrentLevel] = useState(initial?.automationLevel ?? 3)
  const [pendingLevel, setPendingLevel] = useState<number | null>(null)
  const [levelSaving, setLevelSaving] = useState(false)
  const [levelError, setLevelError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(initial?.enabled ?? false)
  const [threshold, setThreshold] = useState(String(initial?.confidenceThreshold ?? 0.85))
  const [maxSends, setMaxSends] = useState(String(initial?.maxAutoSendsPerDay ?? 10))
  const [disableAfter, setDisableAfter] = useState(String(initial?.disableAfterFailures ?? 3))
  const [categoryPolicies, setCategoryPolicies] = useState<Record<string, CategoryPolicy>>(
    (() => {
      const raw = initial?.categoryThresholds ?? {}
      const result: Record<string, CategoryPolicy> = {}
      const VALID_ACTIONS: CategoryPolicy["action"][] = ["auto_send", "require_approval", "never"]
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") {
          result[k] = { action: "auto_send", threshold: v }
        } else if (typeof v === "object" && v !== null) {
          const action = (v as RawCategoryPolicy).action
          if (VALID_ACTIONS.includes(action as CategoryPolicy["action"])) {
            result[k] = { action: action as CategoryPolicy["action"], threshold: (v as RawCategoryPolicy).threshold }
          }
        }
      }
      return result
    })()
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDisabled = !!initial?.disabledAt
  const blockedByLearning = requiresLearnedProfile && !hasLearnedProfile
  const currentFailures = initial?.currentFailures ?? 0

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
          maxAutoSendsPerDay: parseInt(maxSends, 10),
          disableAfterFailures: parseInt(disableAfter, 10),
          categoryThresholds: categoryPolicies,
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

  async function handleConfirmLevel() {
    if (pendingLevel === null) return
    setLevelSaving(true)
    setLevelError(null)
    try {
      const res = await fetch("/api/autopilot-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationLevel: pendingLevel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to change level")
      setCurrentLevel(pendingLevel)
      setPendingLevel(null)
    } catch (err) {
      setLevelError(err instanceof Error ? err.message : "Failed to change level")
    } finally {
      setLevelSaving(false)
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

  const pendingInfo = pendingLevel !== null ? AUTOMATION_LEVELS[pendingLevel] : null

  return (
    <div className="space-y-4">
      {/* Trust ladder: the primary control. Levels are a ceiling on what the
          agent may do; the advanced settings below stay as additional gates. */}
      <div className="space-y-2" role="radiogroup" aria-label="Automation level">
        {AUTOMATION_LEVELS.map(({ level, name, does, wont }) => {
          const isCurrent = level === currentLevel
          const isPending = level === pendingLevel
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              onClick={() => {
                setLevelError(null)
                setPendingLevel(level === currentLevel ? null : level)
              }}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                isCurrent
                  ? "border-slate-900 bg-slate-900 text-white"
                  : isPending
                    ? "border-slate-400 bg-slate-100"
                    : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Level {level}: {name}
                </p>
                {isCurrent && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
                    Current
                  </span>
                )}
              </div>
              <p className={`mt-1 text-xs ${isCurrent ? "text-slate-200" : "text-slate-600"}`}>
                {does}
              </p>
              <p className={`mt-0.5 text-xs ${isCurrent ? "text-slate-300" : "text-slate-400"}`}>
                {wont}
              </p>
            </button>
          )
        })}
      </div>

      {pendingInfo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            Switch to Level {pendingInfo.level}: {pendingInfo.name}?
          </p>
          <p className="mt-1 text-xs">
            {pendingInfo.does} {pendingInfo.wont}
            {pendingInfo.level === 5 &&
              " Auto-send additionally requires autopilot to be enabled in the advanced settings below."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleConfirmLevel}
              disabled={levelSaving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {levelSaving ? "Saving..." : `Confirm Level ${pendingInfo.level}`}
            </button>
            <button
              onClick={() => setPendingLevel(null)}
              disabled={levelSaving}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {levelError && <p className="text-xs text-red-600">{levelError}</p>}

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
          {currentFailures} consecutive failure{currentFailures !== 1 ? "s" : ""} &mdash; will auto-disable after {initial?.disableAfterFailures}.
        </div>
      )}

      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-700">
          Advanced auto-send settings
          <span className="ml-2 text-xs font-normal text-slate-400">
            thresholds, caps, and per-category policies — these gates apply on top of the level above
          </span>
        </summary>
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Enable autopilot</p>
          <p className="text-xs text-slate-500">
            AI sends replies automatically when all safety conditions are met.
            Auto-send also requires Level 5 above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          disabled={isDisabled || blockedByLearning}
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

      {blockedByLearning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Train reply learning before enabling auto-send.
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
        {/* Confidence threshold */}
        <div>
          <label className="text-xs font-medium text-slate-600">
            Minimum confidence threshold (0.5 &ndash; 1.0)
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

        {/* Per-category autopilot policy */}
        <div>
          <p className="text-xs font-medium text-slate-600">Per-category policy</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Override autopilot behavior for specific attention categories.
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
            Per-category policies are saved but not yet enforced at runtime — coming in the next update.
          </p>
          <div className="mt-2 space-y-2">
            {CATEGORY_OPTIONS.map(({ key, label }) => {
              const policy = categoryPolicies[key]
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-slate-600">{label}</span>
                  <select
                    value={policy?.action ?? ""}
                    onChange={(e) => {
                      const action = e.target.value as CategoryPolicy["action"] | ""
                      setCategoryPolicies((prev) => {
                        const next = { ...prev }
                        if (!action) { delete next[key]; return next }
                        next[key] = { action, threshold: prev[key]?.threshold }
                        return next
                      })
                    }}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="">Default</option>
                    <option value="auto_send">Auto-send</option>
                    <option value="require_approval">Require approval</option>
                    <option value="never">Never auto-send</option>
                  </select>
                  {policy?.action === "auto_send" && (
                    <input
                      type="number"
                      step={0.05}
                      min={0.5}
                      max={1.0}
                      placeholder="threshold"
                      value={policy.threshold ?? ""}
                      onChange={(e) => {
                        const val = e.target.value === "" ? undefined : parseFloat(e.target.value)
                        setCategoryPolicies((prev) => ({ ...prev, [key]: { ...prev[key], threshold: val } }))
                      }}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  )}
                </div>
              )
            })}
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
        disabled={saving || blockedByLearning}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save"}
      </button>
        </div>
      </details>
    </div>
  )
}
