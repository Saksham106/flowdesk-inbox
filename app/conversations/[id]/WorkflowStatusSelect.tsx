// app/conversations/[id]/WorkflowStatusSelect.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { FlowDeskGmailLabelName } from "@/lib/gmail-labels"
import { deriveWorkflowStatus, aiCategoryLabel } from "@/lib/workflow-status"
import { FLOWDESK_LABEL_OPTIONS, currentFlowDeskLabel } from "@/lib/flowdesk-label-display"

interface Props {
  conversationId: string
  status: string
  userState?: string | null
  draftStatus?: string | null
  attentionCategory?: string | null
  emailType?: string | null
}

/**
 * The single canonical-label selector for the thread sidebar. Replaces the
 * old four-option workflow-status dropdown — it now exposes the full
 * FLOWDESK_GMAIL_LABEL_NAMES vocabulary (lib/gmail-labels.ts) and writes
 * through the unified PATCH /flowdesk-label endpoint (lib/conversation-labels.ts),
 * which performs the state update + audit log + classification correction +
 * Gmail writeback + revalidation side effects a manual label change needs.
 * "Autodrafted" can't be selected unless a draft is already proposed/approved
 * — the server rejects it too, this just avoids a round trip for the common case.
 */
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
  const [selected, setSelected] = useState<FlowDeskGmailLabelName>(
    currentFlowDeskLabel(attentionCategory, emailType, derived)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = deriveWorkflowStatus({ status, userState, draftStatus, attentionCategory, emailType })
    setSelected(currentFlowDeskLabel(attentionCategory, emailType, d))
  }, [status, userState, draftStatus, attentionCategory, emailType])

  const categoryLabel = aiCategoryLabel(attentionCategory, emailType)
  const hasDraft = draftStatus === "proposed" || draftStatus === "approved"

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as FlowDeskGmailLabelName
    if (next === selected) return
    if (next === "Autodrafted" && !hasDraft) return
    const prev = selected
    setSelected(next)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/flowdesk-label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next }),
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
      <label className="text-xs text-slate-500">Label</label>
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
        {FLOWDESK_LABEL_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value} disabled={value === "Autodrafted" && !hasDraft}>
            {label}
          </option>
        ))}
      </select>
      {categoryLabel && (
        <p className="mt-1 text-[10px] text-slate-400">AI category: {categoryLabel}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
