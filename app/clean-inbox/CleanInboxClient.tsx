"use client"
import { useMemo, useState } from "react"
import Link from "next/link"

export type SenderGroupView = {
  senderEmail: string
  senderName: string
  domain: string
  count: number
  sampleSubjects: string[]
  conversationIds: string[]
  hasUnsubscribe: boolean
}

type GroupStatus = {
  loading: boolean
  done: "archived" | "unsubscribed" | null
  batchToken: string | null
  undone: boolean
}

const EMPTY: GroupStatus = { loading: false, done: null, batchToken: null, undone: false }

export default function CleanInboxClient({ groups }: { groups: SenderGroupView[] }) {
  const [status, setStatus] = useState<Record<string, GroupStatus>>({})

  function patch(key: string, next: Partial<GroupStatus>) {
    setStatus((prev) => ({ ...prev, [key]: { ...EMPTY, ...prev[key], ...next } }))
  }

  async function runBatch(
    group: SenderGroupView,
    endpoint: "archive-batch" | "unsubscribe-batch"
  ) {
    patch(group.senderEmail, { loading: true })
    try {
      const res = await fetch(`/api/clean-inbox/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: group.conversationIds }),
      })
      const data = await res.json().catch(() => ({}))
      patch(group.senderEmail, {
        loading: false,
        done: res.ok ? (endpoint === "archive-batch" ? "archived" : "unsubscribed") : null,
        batchToken: data.batchToken ?? null,
      })
    } catch {
      patch(group.senderEmail, { loading: false })
    }
  }

  async function undo(group: SenderGroupView) {
    const token = status[group.senderEmail]?.batchToken
    if (!token) return
    patch(group.senderEmail, { loading: true })
    await fetch(`/api/clean-inbox/undo/${token}`, { method: "POST" }).catch(() => {})
    patch(group.senderEmail, { loading: false, undone: true })
  }

  const { totalEmails, remainingSenders } = useMemo(() => {
    const remaining = groups.filter((g) => !status[g.senderEmail]?.done)
    return {
      totalEmails: remaining.reduce((sum, g) => sum + g.count, 0),
      remainingSenders: remaining.length,
    }
  }, [groups, status])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/home" className="text-xs text-slate-400 hover:text-slate-700">
          ← Back to control room
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Clean up by sender</h1>
        {remainingSenders > 0 ? (
          <p className="mt-1 text-sm text-slate-500">
            Clear {totalEmails.toLocaleString()} email{totalEmails === 1 ? "" : "s"} from{" "}
            {remainingSenders} sender{remainingSenders === 1 ? "" : "s"}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">Nothing left to clean up.</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Archived in Gmail, not deleted · your Needs Reply and receipts are never touched · undo
          within 1 hour.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Your inbox looks clean.</p>
          <p className="mt-1 text-xs text-slate-400">
            No newsletters, marketing, or quietly-handled mail to group right now.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <SenderCard
              key={group.senderEmail}
              group={group}
              status={status[group.senderEmail] ?? EMPTY}
              onArchive={() => runBatch(group, "archive-batch")}
              onUnsubscribe={() => runBatch(group, "unsubscribe-batch")}
              onUndo={() => undo(group)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SenderCard({
  group,
  status,
  onArchive,
  onUnsubscribe,
  onUndo,
}: {
  group: SenderGroupView
  status: GroupStatus
  onArchive: () => void
  onUnsubscribe: () => void
  onUndo: () => void
}) {
  const resolved = status.done && !status.undone

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{group.senderName}</p>
          <span className="shrink-0 text-xs text-slate-400">{group.senderEmail}</span>
          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700">
            {group.count}
          </span>
        </div>
        {group.sampleSubjects.length > 0 && (
          <p className="mt-1 truncate text-xs text-slate-500">
            {group.sampleSubjects.join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {resolved ? (
          <>
            <span className="text-xs font-medium text-green-600">
              {status.done === "unsubscribed" ? "Unsubscribed" : "Archived"}
            </span>
            {status.batchToken && (
              <button
                onClick={onUndo}
                disabled={status.loading}
                className="text-xs text-slate-400 underline hover:text-slate-700 disabled:opacity-50"
              >
                {status.loading ? "Undoing…" : "Undo"}
              </button>
            )}
          </>
        ) : status.undone ? (
          <span className="text-xs text-slate-400">Restored</span>
        ) : (
          <>
            <button
              onClick={onArchive}
              disabled={status.loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {status.loading ? "Working…" : "Archive all"}
            </button>
            {group.hasUnsubscribe && (
              <button
                onClick={onUnsubscribe}
                disabled={status.loading}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                Unsubscribe + archive
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
