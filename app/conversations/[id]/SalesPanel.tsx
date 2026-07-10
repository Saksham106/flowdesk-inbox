"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type SalesPanelProps = {
  conversationId: string
  closingStage: string
  extractedBudget: string | null
  extractedTimeline: string | null
  suggestedAction: string
  /** CRM pipeline label (Lead/Reschedule/Pricing/Complaint) — business-only,
   * scoped to the sales pipeline rather than the general FlowDesk label
   * vocabulary, so it lives here instead of the general contact card. */
  pipelineLabel: string | null
}

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-violet-100 text-violet-700",
  closing: "bg-emerald-100 text-emerald-700",
}

const PIPELINE_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const

export default function SalesPanel({
  conversationId,
  closingStage,
  extractedBudget,
  extractedTimeline,
  suggestedAction,
  pipelineLabel,
}: SalesPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingLabel, setSavingLabel] = useState(false)

  async function handlePipelineLabelChange(value: string) {
    setSavingLabel(true)
    await fetch(`/api/conversations/${conversationId}/label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: value === "none" ? null : value }),
    })
    setSavingLabel(false)
    router.refresh()
  }

  async function handleGenerateDraft() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/draft/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "close_sale" }),
      })
      if (!res.ok) throw new Error("Failed to generate draft")
      router.refresh()
    } catch {
      setError("Failed to generate draft. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-emerald-100 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Sales
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STAGE_COLORS[closingStage] ?? "bg-slate-100 text-slate-700"}`}
        >
          {closingStage}
        </span>
      </div>

      <div className="space-y-2 px-4 py-3">
        {extractedBudget && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-800">Budget:</span>
            <span className="text-xs text-slate-700">{extractedBudget}</span>
          </div>
        )}
        {extractedTimeline && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-800">Timeline:</span>
            <span className="text-xs text-slate-700">{extractedTimeline}</span>
          </div>
        )}
        {suggestedAction && (
          <p className="mt-1 text-xs text-slate-600">{suggestedAction}</p>
        )}
        <button
          onClick={handleGenerateDraft}
          disabled={loading}
          className="mt-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate closing draft"}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

        <div className="mt-2 border-t border-emerald-100 pt-2">
          <label className="text-xs font-medium text-emerald-800">Pipeline label</label>
          <select
            value={pipelineLabel ?? "none"}
            onChange={(e) => handlePipelineLabelChange(e.target.value)}
            disabled={savingLabel}
            className="mt-1 block w-full rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
          >
            <option value="none">No label</option>
            {PIPELINE_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
