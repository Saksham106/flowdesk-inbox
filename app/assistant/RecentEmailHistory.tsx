"use client"

import Link from "next/link"
import { useState } from "react"

import { FLOWDESK_LABEL_OPTIONS } from "@/lib/flowdesk-label-display"
import type { FlowDeskGmailLabelName } from "@/lib/email-labels"

export type RecentEmailRow = {
  id: string
  sender: string
  senderEmail: string | null
  subject: string
  receivedAt: string
  label: FlowDeskGmailLabelName
}

export default function RecentEmailHistory({ initialRows }: { initialRows: RecentEmailRow[] }) {
  const [rows, setRows] = useState(initialRows)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState<FlowDeskGmailLabelName>("Needs Reply")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function edit(row: RecentEmailRow) {
    setEditingId(row.id)
    setDraftLabel(row.label)
    setError(null)
  }

  async function save(row: RecentEmailRow) {
    setPendingId(row.id)
    setError(null)
    const response = await fetch(`/api/conversations/${row.id}/flowdesk-label`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: draftLabel }),
    }).catch(() => null)
    setPendingId(null)
    if (!response?.ok) {
      setError("Could not save that correction. Your previous label is unchanged.")
      return
    }
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, label: draftLabel } : item))
    setEditingId(null)
  }

  if (rows.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><p className="text-sm font-medium text-slate-700">No recent emails yet.</p><p className="mt-1 text-xs text-slate-500">Connect and sync an inbox to review FlowDesk’s classifications.</p><Link href="/settings/connect" className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline">Open connection settings →</Link></div>
  }

  return (
    <div aria-live="polite" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {error && <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
      <div className="hidden grid-cols-[minmax(0,1fr)_170px_100px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500 sm:grid"><span>Email</span><span>FlowDesk label</span><span /></div>
      {rows.map((row) => (
        <article key={row.id} className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_170px_100px] sm:items-center">
          <div className="min-w-0"><Link href={`/conversations/${row.id}`} className="block truncate text-sm font-semibold text-slate-900 hover:underline" title={row.subject}>{row.subject}</Link><p className="truncate text-xs text-slate-500" title={row.senderEmail ?? row.sender}>{row.sender}{row.senderEmail ? ` · ${row.senderEmail}` : ""} · {relativeTime(row.receivedAt)}</p></div>
          {editingId === row.id ? (
            <label className="text-[11px] font-medium text-slate-600">Correct label<select value={draftLabel} onChange={(event) => setDraftLabel(event.target.value as FlowDeskGmailLabelName)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{FLOWDESK_LABEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          ) : <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{row.label}</span>}
          <div className="flex gap-2 sm:justify-end">{editingId === row.id ? <><button type="button" onClick={() => save(row)} disabled={pendingId === row.id} aria-label={`Save label correction for ${row.subject}`} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white disabled:opacity-50">Save</button><button type="button" onClick={() => setEditingId(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600">Cancel</button></> : <button type="button" onClick={() => edit(row)} aria-label={`Adjust label for ${row.subject}`} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">Adjust</button>}</div>
        </article>
      ))}
    </div>
  )
}

function relativeTime(value: string) {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000))
  if (hours < 1) return "just now"
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
