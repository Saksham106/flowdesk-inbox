"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

type Task = {
  id: string
  title: string
  status: string
  dueAt: Date | null
  conversationId: string
  conversation: {
    contact: { name: string } | null
    externalThreadId: string
  }
}

function TaskRow({ task }: { task: Task }) {
  const router = useRouter()
  const [editingDue, setEditingDue] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const displayName = task.conversation.contact?.name ?? task.conversation.externalThreadId
  const isOverdue = task.dueAt && task.dueAt < new Date()

  async function saveDue(value: string) {
    setSaving(true)
    setEditingDue(false)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${task.id}/due`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: value || null }),
      })
      if (!res.ok) {
        setError("Could not save due date.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not save due date.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{displayName}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-3">
        {editingDue ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.dueAt ? task.dueAt.toISOString().slice(0, 10) : ""}
            onBlur={(e) => saveDue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveDue((e.target as HTMLInputElement).value)
              if (e.key === "Escape") setEditingDue(false)
            }}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        ) : (
          <button
            onClick={() => setEditingDue(true)}
            disabled={saving}
            className={`rounded px-2 py-0.5 text-xs transition hover:bg-slate-100 disabled:opacity-50 ${
              isOverdue
                ? "font-semibold text-red-600"
                : task.dueAt
                ? "text-slate-600"
                : "text-slate-400"
            }`}
            title="Click to edit due date"
          >
          {saving ? "…" : task.dueAt ? task.dueAt.toLocaleDateString() : "Set due date"}
        </button>
        )}
        <Link
          href={`/conversations/${task.conversationId}`}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          View →
        </Link>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    </li>
  )
}

export default function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null
  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  )
}
