"use client"
import { useState } from "react"

type WorkflowStep = {
  type: string
  days?: number
  taskTitle?: string
}

type WorkflowTemplate = {
  id: string
  name: string
  trigger: string
  stepsJson: WorkflowStep[]
  enabled: boolean
}

export default function WorkflowsPanel({
  initialTemplates,
  activeCounts,
}: {
  initialTemplates: WorkflowTemplate[]
  activeCounts: Record<string, number>
}) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function toggleEnabled(id: string, enabled: boolean) {
    setPending((p) => ({ ...p, [id]: true }))
    await fetch(`/api/workflow-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)))
    setPending((p) => ({ ...p, [id]: false }))
  }

  if (templates.length === 0) return <p className="text-sm text-slate-500">No workflows yet.</p>

  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <div key={t.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">{t.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {t.stepsJson.length} steps &middot; Trigger: {t.trigger.replace(/_/g, " ")}
              </p>
              {(activeCounts[t.id] ?? 0) > 0 && (
                <p className="mt-0.5 text-xs text-[var(--color-accent)]">{activeCounts[t.id]} active runs</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggleEnabled(t.id, !t.enabled)}
              disabled={pending[t.id]}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${t.enabled ? "bg-slate-900" : "bg-slate-300"}`}
              aria-pressed={t.enabled}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${t.enabled ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
