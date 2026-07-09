"use client"

import Link from "next/link"
import { useState } from "react"

type RelabelResult = {
  channels: number
  labelsEnsured: number
  scanned: number
  queued: number
  errors: number
  hasMore: boolean
  automationLevel: number
  belowAutomationLevel: boolean
  minAutomationLevel: number
}

export default function FixGmailLabelsButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RelabelResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/connectors/gmail/relabel", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Couldn't fix labels")
      setResult(data as RelabelResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fix labels")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">Fix Gmail labels</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Recolors your FlowDesk labels and re-applies them to your existing emails.
            Use this if you connected Gmail a while ago and your labels look uncolored
            or your emails aren&apos;t labeled — a one-time catch-up, not a routine sync.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={loading}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {loading ? "Fixing…" : "Fix Gmail labels"}
        </button>
      </div>
      {result && result.belowAutomationLevel && (
        <p className="mt-2 text-xs text-amber-700">
          Your automation level is {result.automationLevel} — FlowDesk needs Level{" "}
          {result.minAutomationLevel} or higher before it will apply Gmail labels automatically.{" "}
          <Link href="/settings/automation" className="font-medium underline">
            Raise it in Automation settings
          </Link>{" "}
          and click Fix Gmail labels again.
        </p>
      )}
      {result && !result.belowAutomationLevel && (
        <p className="mt-2 text-xs text-slate-500">
          {result.queued > 0
            ? `Re-applying labels to ${result.queued} of ${result.scanned} recent emails. This can take a moment to show up in Gmail.`
            : result.scanned > 0
              ? "Everything was already up to date."
              : "No emails found to fix yet."}
          {result.hasMore && <> Click again to catch up on older emails.</>}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
