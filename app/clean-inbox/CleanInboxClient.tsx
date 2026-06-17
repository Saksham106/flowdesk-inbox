"use client"
import { useState } from "react"
import Link from "next/link"

type EmailItem = { id: string; subject: string; sender: string; hasUnsubscribeUrl?: boolean }

function BatchSection({
  title,
  description,
  items,
  actionLabel,
  onAction,
  loading,
  done,
  batchToken,
}: {
  title: string
  description: string
  items: EmailItem[]
  actionLabel: string
  onAction: (ids: string[]) => Promise<string | null>
  loading: boolean
  done: boolean
  batchToken: string | null
}) {
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)

  async function handleUndo() {
    if (!batchToken) return
    setUndoing(true)
    await fetch(`/api/clean-inbox/undo/${batchToken}`, { method: "POST" })
    setUndone(true)
    setUndoing(false)
  }

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          <p className="mt-1 text-xs font-medium text-slate-700">{items.length} emails</p>
        </div>
        {!done && !undone && (
          <button
            onClick={() => onAction(items.map((i) => i.id))}
            disabled={loading}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Working..." : actionLabel}
          </button>
        )}
        {done && !undone && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Done</span>
            {batchToken && (
              <button
                onClick={handleUndo}
                disabled={undoing}
                className="text-xs text-slate-400 underline hover:text-slate-700"
              >
                {undoing ? "Undoing..." : "Undo"}
              </button>
            )}
          </div>
        )}
        {undone && <span className="text-xs text-slate-400">Restored</span>}
      </div>
      <div className="mt-4 space-y-1 max-h-48 overflow-y-auto">
        {items.slice(0, 20).map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-xs text-slate-500">
            <span className="truncate">{item.subject}</span>
            <span className="shrink-0 text-slate-300">·</span>
            <span className="shrink-0 text-slate-400">{item.sender}</span>
          </div>
        ))}
        {items.length > 20 && (
          <p className="text-xs text-slate-400">...and {items.length - 20} more</p>
        )}
      </div>
    </div>
  )
}

export default function CleanInboxClient({
  newsletters,
  quietEmails,
  fyiDone,
}: {
  newsletters: (EmailItem & { hasUnsubscribeUrl?: boolean })[]
  quietEmails: EmailItem[]
  fyiDone: EmailItem[]
}) {
  const [tokens, setTokens] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})

  async function archiveBatch(key: string, ids: string[]): Promise<string | null> {
    setLoading((p) => ({ ...p, [key]: true }))
    const res = await fetch("/api/clean-inbox/archive-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: ids }),
    })
    const data = await res.json()
    setDone((p) => ({ ...p, [key]: true }))
    setLoading((p) => ({ ...p, [key]: false }))
    setTokens((p) => ({ ...p, [key]: data.batchToken ?? null }))
    return data.batchToken ?? null
  }

  async function unsubscribeBatch(key: string, ids: string[]): Promise<string | null> {
    setLoading((p) => ({ ...p, [key]: true }))
    const res = await fetch("/api/clean-inbox/unsubscribe-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: ids }),
    })
    const data = await res.json()
    setDone((p) => ({ ...p, [key]: true }))
    setLoading((p) => ({ ...p, [key]: false }))
    setTokens((p) => ({ ...p, [key]: data.batchToken ?? null }))
    return data.batchToken ?? null
  }

  const total = newsletters.length + quietEmails.length + fyiDone.length

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/inbox" className="text-xs text-slate-400 hover:text-slate-700">Back to inbox</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Clean My Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          {total} emails can be cleared. Each action is reversible within 1 hour.
        </p>
      </div>

      <div className="space-y-4">
        <BatchSection
          title="Newsletters &amp; Marketing"
          description="Unsubscribe from mailing lists and archive these emails."
          items={newsletters}
          actionLabel={`Unsubscribe & Archive ${newsletters.length}`}
          onAction={(ids) => unsubscribeBatch("newsletters", ids)}
          loading={loading.newsletters ?? false}
          done={done.newsletters ?? false}
          batchToken={tokens.newsletters ?? null}
        />
        <BatchSection
          title="Quiet Emails"
          description="These were automatically marked quiet. Archive them to clean up."
          items={quietEmails}
          actionLabel={`Archive ${quietEmails.length}`}
          onAction={(ids) => archiveBatch("quiet", ids)}
          loading={loading.quiet ?? false}
          done={done.quiet ?? false}
          batchToken={tokens.quiet ?? null}
        />
        <BatchSection
          title="FYI / Already Done"
          description="Informational emails with no action needed."
          items={fyiDone}
          actionLabel={`Archive ${fyiDone.length}`}
          onAction={(ids) => archiveBatch("fyi", ids)}
          loading={loading.fyi ?? false}
          done={done.fyi ?? false}
          batchToken={tokens.fyi ?? null}
        />

        {total === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-700">Your inbox looks clean!</p>
            <p className="mt-1 text-xs text-slate-400">No newsletters, quiet emails, or FYI items found.</p>
          </div>
        )}
      </div>
    </div>
  )
}
