"use client"

import Link from "next/link"
import { useState } from "react"

import ApprovalActions from "./ApprovalActions"

type ApprovalItem = {
  id: string
  conversationId: string
  displayName: string
  lastMessageBody: string | null
  draftText: string | null
  intent: string | null
  riskLevel: string | null
  confidence: string | null
}

export default function ApprovalList({ items }: { items: ApprovalItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [expandedDraft, setExpandedDraft] = useState<Set<string>>(new Set())
  const [bulkError, setBulkError] = useState<string | null>(null)

  const visible = items.filter((item) => !dismissed.has(item.id))
  const allSelected = visible.length > 0 && visible.every((i) => selected.has(i.id))

  function handleDecided(id: string) {
    setDismissed((prev) => new Set([...prev, id]))
    setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visible.map((i) => i.id)))
    }
  }

  function toggleDraft(id: string) {
    setExpandedDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  async function bulkDecide(decision: "approved" | "rejected") {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkLoading(true)
    setBulkError(null)
    try {
      const res = await fetch("/api/approvals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, decision }),
      })
      if (!res.ok) {
        setBulkError("Could not update selected approvals.")
        return
      }
      setDismissed((prev) => new Set([...prev, ...ids]))
      setSelected(new Set())
    } catch {
      setBulkError("Could not update selected approvals.")
    } finally {
      setBulkLoading(false)
    }
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
        Nothing needs approval right now.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Bulk action bar */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
          />
          {selected.size > 0
            ? `${selected.size} selected`
            : `Select all (${visible.length})`}
        </label>
        {selected.size > 0 && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => bulkDecide("approved")}
                disabled={bulkLoading}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkLoading ? "…" : `Approve ${selected.size}`}
              </button>
              <button
                onClick={() => bulkDecide("rejected")}
                disabled={bulkLoading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {bulkLoading ? "…" : `Reject ${selected.size}`}
              </button>
            </div>
            {bulkError ? <p className="text-xs text-red-600">{bulkError}</p> : null}
          </div>
        )}
      </div>

      {/* Individual items */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {visible.map((item) => (
            <li key={item.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/conversations/${item.conversationId}`}
                        className="hover:opacity-80"
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {item.displayName}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {item.lastMessageBody ?? "No recent message"}
                        </p>
                      </Link>

                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        {item.intent ? <span>Intent: {item.intent}</span> : null}
                        {item.riskLevel ? <span>Risk: {item.riskLevel}</span> : null}
                        {item.confidence ? <span>Confidence: {item.confidence}</span> : null}
                      </div>

                      {/* Draft preview */}
                      {item.draftText ? (
                        <div className="mt-3">
                          <button
                            onClick={() => toggleDraft(item.id)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            <span>{expandedDraft.has(item.id) ? "▾" : "▸"}</span>
                            Draft reply
                          </button>
                          {expandedDraft.has(item.id) && (
                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                              {item.draftText}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <ApprovalActions approvalId={item.id} onDecided={handleDecided} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
