"use client"

import { useState } from "react"

type LabelSetting = { canonical: string; enabled: boolean }

export default function GmailLabelSettingsPanel({
  initial,
}: {
  initial: LabelSetting[]
}) {
  const [labels, setLabels] = useState<LabelSetting[]>(initial)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(canonical: string, next: boolean) {
    setError(null)
    setPending(canonical)
    // Optimistic update
    setLabels((prev) =>
      prev.map((l) => (l.canonical === canonical ? { ...l, enabled: next } : l))
    )
    try {
      const res = await fetch("/api/gmail-label-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical, enabled: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to save")
      }
    } catch (err) {
      // Roll back on failure
      setLabels((prev) =>
        prev.map((l) =>
          l.canonical === canonical ? { ...l, enabled: !next } : l
        )
      )
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Choose which FlowDesk labels appear in your inbox (Gmail labels /
        Outlook categories). Disabled labels are skipped when FlowDesk
        organizes your inbox. (Renaming labels is coming soon.)
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
        {labels.map((label) => {
          const display = label.canonical.replace(/^FlowDesk\//, "")
          return (
            <li
              key={label.canonical}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="text-sm text-slate-700">{display}</span>
              <button
                type="button"
                onClick={() => toggle(label.canonical, !label.enabled)}
                disabled={pending === label.canonical}
                aria-pressed={label.enabled}
                aria-label={`${label.enabled ? "Disable" : "Enable"} ${display}`}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                  label.enabled ? "bg-slate-900" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    label.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
