"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { BillSignal } from "@/lib/agent/command-center"

interface ItemRowProps {
  item: BillSignal
}

function BillItem({ item }: ItemRowProps) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  async function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissed(true)
    setError(null)
    try {
      let res: Response
      if (item.type === "task" && item.taskId) {
        res = await fetch(`/api/tasks/${item.taskId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "closed" }),
        })
      } else {
        res = await fetch(`/api/conversations/${item.conversationId}/attention`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attentionCategory: "fyi_done" }),
        })
      }
      if (!res.ok) throw new Error("Failed to dismiss")
      router.refresh()
    } catch {
      setDismissed(false)
      setError("Couldn't dismiss")
    }
  }

  return (
    <li className="group flex items-start justify-between gap-2">
      <a href={item.href} className="flex-1 min-w-0 flex items-start justify-between gap-2 text-sm hover:underline">
        <span className="min-w-0">
          <span className="font-medium text-slate-800">{item.displayName}</span>
          <span className="ml-1.5 text-slate-500">{item.title}</span>
        </span>
        {item.dueAt && (
          <span className="shrink-0 whitespace-nowrap text-xs text-amber-600">
            Due {item.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </a>
      <div className="flex items-center gap-1 shrink-0">
        {error && <span className="text-[10px] text-red-500">{error}</span>}
        <button
          type="button"
          onClick={handleDismiss}
          title="Mark done"
          className="opacity-0 group-hover:opacity-100 transition-opacity flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          aria-label="Mark done"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 6.5 5 9.5 10 3" />
          </svg>
        </button>
      </div>
    </li>
  )
}

interface Props {
  items: BillSignal[]
}

export default function BillsDeadlinesList({ items }: Props) {
  return (
    <ul className="mt-3 space-y-2">
      {items.map((item) => (
        <BillItem key={`${item.conversationId}-${item.title}`} item={item} />
      ))}
    </ul>
  )
}
