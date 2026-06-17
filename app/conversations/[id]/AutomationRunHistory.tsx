"use client"
import { useState } from "react"

type AutomationStep = { type: string; status?: string; error?: string }
type AutomationRun = {
  id: string
  trigger: string
  status: string
  stepsJson: AutomationStep[]
  createdAt: string
  rolledBackAt: string | null
}

export default function AutomationRunHistory({ runs }: { runs: AutomationRun[] }) {
  const [rolling, setRolling] = useState<Record<string, boolean>>({})
  const [rolledBack, setRolledBack] = useState<Set<string>>(new Set())

  async function handleRollback(id: string) {
    setRolling((p) => ({ ...p, [id]: true }))
    await fetch(`/api/automation-runs/${id}/rollback`, { method: "POST" })
    setRolledBack((p) => new Set([...p, id]))
    setRolling((p) => ({ ...p, [id]: false }))
  }

  if (runs.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Automations</p>
      {runs.map((run) => (
        <div key={run.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-slate-700">{run.trigger.replace(/_/g, " ")}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {run.stepsJson.length} steps · {run.status}
              </p>
            </div>
            {run.status === "completed" && !rolledBack.has(run.id) && !run.rolledBackAt && (
              <button
                onClick={() => handleRollback(run.id)}
                disabled={rolling[run.id]}
                className="shrink-0 text-xs text-slate-400 underline hover:text-red-500"
              >
                {rolling[run.id] ? "…" : "Undo"}
              </button>
            )}
            {(rolledBack.has(run.id) || run.rolledBackAt) && (
              <span className="text-xs text-slate-400">Undone</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
