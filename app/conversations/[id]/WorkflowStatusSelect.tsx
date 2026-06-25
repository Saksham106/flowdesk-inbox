// app/conversations/[id]/WorkflowStatusSelect.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  deriveWorkflowStatus,
  aiCategoryLabel,
  type WorkflowStatus,
} from "@/lib/workflow-status"

const SETTABLE_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: "needs_reply", label: "Needs Reply" },
  { value: "waiting_on", label: "Waiting On" },
  { value: "read_later", label: "Read Later" },
  { value: "done", label: "Done" },
]

interface Props {
  conversationId: string
  status: string
  userState?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

export default function WorkflowStatusSelect({
  conversationId,
  status,
  userState,
  draftStatus,
  attentionCategory,
  emailType,
}: Props) {
  const router = useRouter()
  const derived = deriveWorkflowStatus({ status, userState, draftStatus, attentionCategory, emailType })
  // draft_ready is AI-driven — show the info pill but select "needs_reply" in the dropdown
  const [selected, setSelected] = useState<WorkflowStatus>(
    derived === "draft_ready" ? "needs_reply" : derived
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = deriveWorkflowStatus({ status, userState, draftStatus, attentionCategory, emailType })
    setSelected(d === "draft_ready" ? "needs_reply" : d)
  }, [status, userState, draftStatus, attentionCategory, emailType])

  const categoryLabel = aiCategoryLabel(attentionCategory, emailType)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as WorkflowStatus
    if (next === selected) return
    const prev = selected
    setSelected(next)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: next }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setSelected(prev)
        setError("Failed to update")
      }
    } catch {
      setSelected(prev)
      setError("Failed to update")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      <label className="text-xs text-slate-500">Status</label>
      {derived === "draft_ready" && (
        <p className="mt-0.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
          Draft Ready — review before sending
        </p>
      )}
      <select
        value={selected}
        onChange={handleChange}
        disabled={saving}
        className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
      >
        {SETTABLE_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {categoryLabel && (
        <p className="mt-1 text-[10px] text-slate-400">AI category: {categoryLabel}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
