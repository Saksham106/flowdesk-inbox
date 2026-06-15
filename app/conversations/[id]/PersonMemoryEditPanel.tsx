"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Fields = {
  summary: string
  preferences: string
  openQuestions: string
  promisedActions: string
}

export default function PersonMemoryEditPanel({
  contactId,
  initial,
  onDone,
}: {
  contactId: string
  initial: Partial<Fields>
  onDone: () => void
}) {
  const router = useRouter()
  const [fields, setFields] = useState<Fields>({
    summary: initial.summary ?? "",
    preferences: initial.preferences ?? "",
    openQuestions: initial.openQuestions ?? "",
    promisedActions: initial.promisedActions ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: keyof Fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/person-memory/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: fields.summary || null,
          preferences: fields.preferences || null,
          openQuestions: fields.openQuestions || null,
          promisedActions: fields.promisedActions || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Failed to save")
      }
      router.refresh()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const fieldLabels: [keyof Fields, string][] = [
    ["summary", "Summary"],
    ["preferences", "Preferences"],
    ["openQuestions", "Open questions"],
    ["promisedActions", "Promised actions"],
  ]

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">Edit relationship memory</p>
      {fieldLabels.map(([key, label]) => (
        <div key={key}>
          <label className="text-xs text-slate-500">{label}</label>
          <textarea
            rows={2}
            value={fields[key]}
            onChange={(e) => update(key, e.target.value)}
            placeholder={`${label}…`}
            className="mt-0.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onDone}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
