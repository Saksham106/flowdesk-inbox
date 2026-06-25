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
        res = await fetch(`/api/conversations/${item.conversationId}/workflow-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowStatus: "done" }),
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
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
        {error && <span className="text-[10px] text-red-500">{error}</span>}
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          aria-label="Done"
        >
          Done
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[10px] font-medium px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:opacity-100"
          aria-label="Not relevant"
        >
          Not relevant
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
