"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type SenderRule = {
  id: string
  matchType: string
  matchValue: string
  targetAttention: string
  status: string
  triggerCount: number
}

const ATTENTION_LABELS: Record<string, string> = {
  needs_reply: "Reply needed",
  needs_action: "Needs action",
  review_soon: "Review soon",
  read_later: "Read later",
  waiting_on: "Waiting on",
  fyi_done: "FYI / Done",
  quiet: "Quiet",
}

export default function SenderRulesPanel({ initialRules }: { initialRules: SenderRule[] }) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const suggested = rules.filter((r) => r.status === "suggested")
  const active = rules.filter((r) => r.status === "active")

  async function act(id: string, action: "accept" | "dismiss") {
    setPending((p) => ({ ...p, [id]: true }))
    const res = await fetch(`/api/sender-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      setRules((prev) =>
        action === "dismiss"
          ? prev.filter((r) => r.id !== id)
          : prev.map((r) => (r.id === id ? { ...r, status: "active" } : r))
      )
      router.refresh()
    }
    setPending((p) => ({ ...p, [id]: false }))
  }

  if (suggested.length === 0 && active.length === 0) return null

  return (
    <div className="space-y-4">
      {suggested.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Suggested rules
          </p>
          <div className="space-y-2">
            {suggested.map((rule) => (
              <div
                key={rule.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {rule.matchType === "email" ? "Sender" : "Domain"}{" "}
                    <span className="font-mono text-xs text-slate-600">{rule.matchValue}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    You&apos;ve changed this to{" "}
                    <span className="font-semibold">{ATTENTION_LABELS[rule.targetAttention] ?? rule.targetAttention}</span>{" "}
                    {rule.triggerCount} times. Apply automatically next time?
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => act(rule.id, "accept")}
                    disabled={pending[rule.id]}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {pending[rule.id] ? "…" : "Apply"}
                  </button>
                  <button
                    onClick={() => act(rule.id, "dismiss")}
                    disabled={pending[rule.id]}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Active rules
          </p>
          <div className="space-y-1">
            {active.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5"
              >
                <p className="min-w-0 text-sm text-slate-700">
                  {rule.matchType === "email" ? "Sender" : "Domain"}{" "}
                  <span className="font-mono text-xs text-slate-500">{rule.matchValue}</span>
                  {" → "}
                  <span className="font-medium">{ATTENTION_LABELS[rule.targetAttention] ?? rule.targetAttention}</span>
                </p>
                <button
                  onClick={() => act(rule.id, "dismiss")}
                  disabled={pending[rule.id]}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >
                  {pending[rule.id] ? "…" : "Disable"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
