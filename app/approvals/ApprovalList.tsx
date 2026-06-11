"use client"

import Link from "next/link"
import { useState } from "react"

import ApprovalActions from "./ApprovalActions"

type ApprovalItem = {
  id: string
  conversationId: string
  displayName: string
  lastMessageBody: string | null
  intent: string | null
  riskLevel: string | null
  confidence: string | null
}

export default function ApprovalList({ items }: { items: ApprovalItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = items.filter((item) => !dismissed.has(item.id))

  function handleDecided(id: string) {
    setDismissed((prev) => new Set([...prev, id]))
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
        Nothing needs approval right now.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <ul className="divide-y divide-slate-100">
        {visible.map((item) => (
          <li key={item.id} className="px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <Link
                href={`/conversations/${item.conversationId}`}
                className="min-w-0 flex-1 hover:opacity-80"
              >
                <p className="truncate text-sm font-semibold text-slate-900">
                  {item.displayName}
                </p>
                <p className="mt-1 truncate text-sm text-slate-500">
                  {item.lastMessageBody ?? "No recent message"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {item.intent ? <span>Intent: {item.intent}</span> : null}
                  {item.riskLevel ? <span>Risk: {item.riskLevel}</span> : null}
                  {item.confidence ? <span>Confidence: {item.confidence}</span> : null}
                </div>
              </Link>
              <ApprovalActions approvalId={item.id} onDecided={handleDecided} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
