"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import type { HomeActionItem } from "@/lib/home-action-feed"

const KIND_LABEL: Record<HomeActionItem["kind"], string> = {
  approval: "Approval",
  reply: "Reply",
  action: "Action",
  deadline: "Deadline",
  follow_up: "Follow up",
}

const KIND_STYLE: Record<HomeActionItem["kind"], string> = {
  approval: "bg-red-50 text-red-700",
  reply: "bg-amber-50 text-amber-700",
  action: "bg-blue-50 text-blue-700",
  deadline: "bg-violet-50 text-violet-700",
  follow_up: "bg-cyan-50 text-cyan-700",
}

type ConversationActionItem = Extract<HomeActionItem, { kind: "reply" | "action" | "follow_up" }>

function isConversationItem(item: HomeActionItem): item is ConversationActionItem {
  return item.kind === "reply" || item.kind === "action" || item.kind === "follow_up"
}

export default function HomeActionFeed({ items }: { items: HomeActionItem[] }) {
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastCompleted, setLastCompleted] = useState<HomeActionItem | null>(null)
  const [drafting, setDrafting] = useState<string | null>(null)

  async function draftReply(item: ConversationActionItem) {
    setDrafting(item.key)
    setError(null)
    try {
      const response = await fetch(`/api/conversations/${item.conversationId}/draft/suggest`, {
        method: "POST",
      }).catch(() => null)
      if (!response?.ok) {
        setError("Could not draft a reply. Please try again.")
        return
      }
      router.push(item.href)
    } finally {
      setDrafting(null)
    }
  }

  async function complete(item: HomeActionItem) {
    if (!item.canComplete) return
    setPending(item.key)
    setError(null)
    setHidden((current) => new Set(current).add(item.key))
    const response = await completionRequest(item).catch(() => null)
    setPending(null)
    if (!response?.ok) {
      setHidden((current) => without(current, item.key))
      setError("Could not complete that item. Please try again.")
      return
    }
    setLastCompleted(item)
    router.refresh()
  }

  async function undo() {
    const item = lastCompleted
    if (!item || !item.canComplete) return
    setPending(item.key)
    setError(null)
    const response = await undoRequest(item).catch(() => null)
    setPending(null)
    if (!response?.ok) {
      setError("Could not restore that item. Please try again.")
      return
    }
    setHidden((current) => without(current, item.key))
    setLastCompleted(null)
    router.refresh()
  }

  const visibleItems = items.filter((item) => !hidden.has(item.key))

  return (
    <div aria-live="polite">
      {error && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {lastCompleted && hidden.has(lastCompleted.key) && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <span>Marked done.</span>
          <button type="button" onClick={undo} disabled={pending === lastCompleted.key} className="font-semibold underline disabled:opacity-50">
            Undo
          </button>
        </div>
      )}
      <div className="space-y-2">
        {visibleItems.map((item) => (
          <article key={item.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${KIND_STYLE[item.kind]}`}>
              {KIND_LABEL[item.kind]}
            </span>
            <div className="min-w-0 flex-1 basis-52">
              <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isConversationItem(item) && (
                <button
                  type="button"
                  onClick={() => draftReply(item)}
                  disabled={drafting === item.key}
                  aria-label={`Draft reply to ${item.title}`}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  {drafting === item.key ? "Drafting…" : "Draft reply"}
                </button>
              )}
              <Link href={item.href} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {item.kind === "approval" ? "Review" : "Open"}
              </Link>
              {item.canComplete && (
                <button
                  type="button"
                  onClick={() => complete(item)}
                  disabled={pending === item.key}
                  aria-label={`Mark ${item.title} done`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  Done
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function completionRequest(item: Exclude<HomeActionItem, { kind: "approval" }>) {
  if (item.kind === "deadline") {
    return fetch(`/api/tasks/${item.taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    })
  }
  return fetch(`/api/conversations/${item.conversationId}/workflow-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowStatus: "done" }),
  })
}

function undoRequest(item: Exclude<HomeActionItem, { kind: "approval" }>) {
  if (item.kind === "deadline") {
    return fetch(`/api/tasks/${item.taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    })
  }
  return fetch(`/api/conversations/${item.conversationId}/workflow-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowStatus: "needs_reply" }),
  })
}

function without(values: Set<string>, key: string) {
  const next = new Set(values)
  next.delete(key)
  return next
}
