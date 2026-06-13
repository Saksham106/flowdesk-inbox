"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

type ConversationStateView = {
  state: string
  priority: string
  reason: string
  nextAction: string
  confidence: number
} | null

type InboxTaskView = {
  id: string
  title: string
  status: string
  dueAt: Date | null
}

type LeadView = {
  id: string
  name: string
  company: string | null
  need: string
  urgency: string
  budgetClue: string | null
  nextAction: string
  score: number
  stage: string
} | null

const LEAD_STAGES = ["new", "contacted", "qualified", "won", "lost"] as const

export default function WorkItemsPanel({
  state,
  tasks,
  lead,
  isPersonal = false,
  bare = false,
}: {
  state: ConversationStateView
  tasks: InboxTaskView[]
  lead: LeadView
  isPersonal?: boolean
  bare?: boolean
}) {
  const router = useRouter()
  const [closingTaskId, setClosingTaskId] = useState<string | null>(null)
  const [stagingLeadId, setStagingLeadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function closeTask(taskId: string) {
    setClosingTaskId(taskId)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      })
      if (!res.ok) {
        setError("Could not close task.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not close task.")
    } finally {
      setClosingTaskId(null)
    }
  }

  async function updateLeadStage(leadId: string, stage: string) {
    setStagingLeadId(leadId)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) {
        setError("Could not update lead stage.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not update lead stage.")
    } finally {
      setStagingLeadId(null)
    }
  }

  const inner = (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">Work items</h2>
          <p className="mt-1 text-xs text-slate-500">
            {isPersonal ? "Tasks and context for this thread." : "Persisted state, tasks, and lead signals for this thread."}
          </p>
        </div>
        {state ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
            {state.priority}
          </span>
        ) : null}
      </div>

      {state ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
          <p className="font-semibold capitalize text-slate-800">
            {state.state.replaceAll("_", " ")}
          </p>
          <p className="mt-1 text-slate-600">{state.reason}</p>
          <p className="mt-2 font-medium text-slate-700">{state.nextAction}</p>
          <p className="mt-2 text-slate-500">
            Confidence: {(state.confidence * 100).toFixed(0)}%
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
          No persisted state yet.
        </p>
      )}

      {tasks.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-slate-600">Tasks</h3>
          <ul className="mt-2 space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{task.title}</p>
                  <p className="mt-1 text-slate-500">
                    {task.dueAt
                      ? `Due ${new Date(task.dueAt).toLocaleDateString()}`
                      : "No due date"}
                  </p>
                </div>
                {task.status === "open" ? (
                  <button
                    onClick={() => closeTask(task.id)}
                    disabled={closingTaskId === task.id}
                    className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  >
                    {closingTaskId === task.id ? "…" : "Close"}
                  </button>
                ) : (
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs text-slate-400">
                    Closed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lead && !isPersonal ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-blue-900">Lead</h3>
            <span className="rounded-full bg-white px-2 py-0.5 font-medium text-blue-700">
              {lead.score}
            </span>
          </div>
          <p className="mt-2 font-medium text-blue-950">
            {lead.company ?? lead.name}
          </p>
          <p className="mt-1 text-blue-800">{lead.need}</p>
          <p className="mt-2 text-blue-700">{lead.nextAction}</p>
          {lead.budgetClue ? (
            <p className="mt-2 text-blue-700">{lead.budgetClue}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <label
              htmlFor={`lead-stage-${lead.id}`}
              className="text-xs text-blue-700"
            >
              Stage:
            </label>
            <select
              id={`lead-stage-${lead.id}`}
              value={lead.stage}
              disabled={stagingLeadId === lead.id}
              onChange={(e) => updateLeadStage(lead.id, e.target.value)}
              className="rounded border border-blue-200 bg-white px-2 py-0.5 text-xs text-blue-900 disabled:opacity-50"
            >
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </div>
  )

  if (bare) return inner

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {inner}
    </div>
  )
}
