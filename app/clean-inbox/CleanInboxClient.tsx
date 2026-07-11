"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import type { CleanupConnectionIssue, CleanupLabelGroupView } from "@/lib/cleanup-candidates"
import { CLEANUP_RANGE_OPTIONS, type CleanupRange } from "@/lib/cleanup-range"

export type SenderGroupView = {
  senderEmail: string
  senderName: string
  domain: string
  count: number
  sampleSubjects: string[]
  conversationIds: string[]
  hasUnsubscribe: boolean
}

type DisplayGroup = {
  key: string
  title: string
  detail: string
  count: number
  conversationIds: string[]
}

export default function CleanInboxClient({
  groups,
  labelGroups,
  mode = "archive",
  range,
  groupMode = "sender",
  protectedOrSkipped = 0,
  noUnsubscribeLinkCount = 0,
  connectionIssue = null,
}: {
  groups: SenderGroupView[]
  labelGroups: CleanupLabelGroupView[]
  mode?: "archive" | "unsubscribe"
  range: CleanupRange
  groupMode?: "sender" | "label"
  protectedOrSkipped?: number
  noUnsubscribeLinkCount?: number
  connectionIssue?: CleanupConnectionIssue | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undoToken, setUndoToken] = useState<string | null>(null)

  const displayGroups: DisplayGroup[] = useMemo(() => {
    if (mode === "archive" && groupMode === "label") {
      return labelGroups.map((group) => ({
        key: `label:${group.label}`,
        title: group.label,
        detail: group.sampleSenders.join(" · ") || "Grouped by FlowDesk label",
        count: group.count,
        conversationIds: group.conversationIds,
      }))
    }
    return groups.map((group) => ({
      key: `sender:${group.senderEmail}`,
      title: group.senderName,
      detail: group.senderEmail,
      count: group.count,
      conversationIds: group.conversationIds,
    }))
  }, [groupMode, groups, labelGroups, mode])

  const visible = displayGroups.filter((group) => !resolved.has(group.key))
  const selectedGroups = visible.filter((group) => selected.has(group.key))
  const selectedConversationIds = uniqueIds(selectedGroups)
  const totalEmails = visible.reduce((sum, group) => sum + group.count, 0)

  function navigate(next: { range?: string; group?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelected(selectedGroups.length === visible.length ? new Set() : new Set(visible.map((group) => group.key)))
  }

  async function run(groupsToRun: DisplayGroup[]) {
    if (groupsToRun.length === 0) return
    setLoading(true)
    setError(null)
    const endpoint = mode === "unsubscribe" ? "unsubscribe-batch" : "archive-batch"
    const response = await fetch(`/api/clean-inbox/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: uniqueIds(groupsToRun) }),
    }).catch(() => null)
    const data = await response?.json().catch(() => ({}))
    setLoading(false)
    if (!response?.ok) {
      setError("Cleanup failed. Your selection is still here so you can retry.")
      return
    }
    const keys = new Set(groupsToRun.map((group) => group.key))
    setResolved((current) => new Set([...current, ...keys]))
    setSelected((current) => new Set([...current].filter((key) => !keys.has(key))))
    setUndoToken(data?.batchToken ?? null)
  }

  async function undo() {
    if (!undoToken) return
    setLoading(true)
    const response = await fetch(`/api/clean-inbox/undo/${undoToken}`, { method: "POST" }).catch(() => null)
    setLoading(false)
    if (!response?.ok) return setError("Could not restore that cleanup batch.")
    setResolved(new Set())
    setUndoToken(null)
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-10">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link href="/home" className="text-xs text-slate-400 hover:text-slate-700">← Back to control room</Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{mode === "unsubscribe" ? "Bulk Unsubscribe" : "Bulk Archive"}</h1>
          <p className="mt-1 text-sm text-slate-500">{totalEmails.toLocaleString()} emails across {visible.length} {groupMode === "label" ? "labels" : "senders"} · {protectedOrSkipped} protected</p>
        </div>
        <label className="text-xs font-medium text-slate-600">
          Time range
          <span className="relative mt-1 block">
            <select
              value={range}
              onChange={(event) => navigate({ range: event.target.value })}
              className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-9 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:w-44"
            >
              {CLEANUP_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">⌄</span>
          </span>
        </label>
      </div>

      {mode === "archive" && (
        <div className="mb-4 inline-flex h-9 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
          {(["sender", "label"] as const).map((value) => (
            <button key={value} onClick={() => navigate({ group: value })} className={`rounded-md px-3 ${groupMode === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>By {value}</button>
          ))}
        </div>
      )}

      <p className="mb-4 text-xs text-slate-400">{mode === "unsubscribe" ? "Unsubscribes and archives in Gmail" : "Archived in Gmail, not deleted"} · protected mail is excluded · undo within 1 hour.</p>
      <div aria-live="polite">
        {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {undoToken && <div className="mb-3 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><span>Cleanup complete.</span><button onClick={undo} disabled={loading} className="font-semibold underline">Undo</button></div>}
      </div>

      {visible.length === 0 && connectionIssue ? <ConnectionIssueCard issue={connectionIssue} /> : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><p className="text-sm font-medium text-slate-700">Your inbox looks clean.</p><p className="mt-1 text-xs text-slate-400">{mode === "unsubscribe" && noUnsubscribeLinkCount ? `${noUnsubscribeLinkCount} cleanable emails have no detected unsubscribe link.` : "No matching cleanup groups in this time range."}</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[40px_minmax(0,1fr)_72px_110px] items-center border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
            <input type="checkbox" checked={selectedGroups.length === visible.length} onChange={toggleAll} aria-label="Select all visible groups" className="h-4 w-4" />
            <span>{groupMode === "label" ? "Label" : "From"}</span><span>Emails ↓</span><span />
          </div>
          {visible.map((group) => (
            <div key={group.key} className="grid grid-cols-[40px_minmax(0,1fr)_72px_110px] items-center border-b border-slate-100 px-3 py-3 last:border-b-0">
              <input type="checkbox" checked={selected.has(group.key)} onChange={() => toggle(group.key)} aria-label={`Select ${group.title}`} className="h-4 w-4" />
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{group.title}</p><p className="truncate text-xs text-slate-400" title={group.detail}>{group.detail}</p></div>
              <strong className="text-lg text-slate-900">{group.count}</strong>
              <button onClick={() => run([group])} disabled={loading} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{mode === "unsubscribe" ? "Unsubscribe" : "Archive"}</button>
            </div>
          ))}
        </div>
      )}

      {selectedGroups.length > 0 && (
        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          <span><strong>{selectedGroups.length} groups</strong> · {selectedConversationIds.length} emails selected</span>
          <button onClick={() => run(selectedGroups)} disabled={loading} className="h-9 rounded-lg bg-white px-4 font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">{mode === "unsubscribe" ? "Unsubscribe selected" : "Archive selected"}</button>
        </div>
      )}
      {range === "all" && <p className="mt-3 text-xs text-slate-400">All synced mail shows the most recent 400 qualifying conversations.</p>}
    </main>
  )
}

function uniqueIds(groups: DisplayGroup[]) {
  return [...new Set(groups.flatMap((group) => group.conversationIds))]
}

const CONNECTION_ISSUE_COPY: Record<CleanupConnectionIssue, { title: string; detail: string; cta: string; href: string }> = {
  not_connected: { title: "No email account connected.", detail: "Connect Gmail so FlowDesk can find mail to clean up.", cta: "Connect Gmail", href: "/api/connectors/gmail/connect" },
  auth_error: { title: "Your Gmail connection has expired.", detail: "Reconnect to resume syncing.", cta: "Reconnect Gmail", href: "/api/connectors/gmail/connect" },
  sync_error: { title: "Email sync is failing.", detail: "This list may be empty or out of date.", cta: "Open Settings", href: "/settings" },
  never_synced: { title: "Your inbox hasn't synced yet.", detail: "Run a sync so FlowDesk can group cleanup mail.", cta: "Open Settings", href: "/settings" },
}

function ConnectionIssueCard({ issue }: { issue: CleanupConnectionIssue }) {
  const copy = CONNECTION_ISSUE_COPY[issue]
  return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><p className="text-sm font-medium text-amber-800">{copy.title}</p><p className="mt-1 text-xs text-amber-700">{copy.detail}</p><a href={copy.href} className="mt-4 inline-block rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">{copy.cta}</a></div>
}
