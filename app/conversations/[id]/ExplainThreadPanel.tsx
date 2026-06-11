"use client"

import { useState } from "react"

type Explanation = {
  whatHappened: string
  whatTheyWant: string
  whatYouNeedToDo: string[]
  risks: string[]
  riskLevel: "low" | "medium" | "high"
  suggestedNextStep: string | null
}

const RISK_BADGE: Record<Explanation["riskLevel"], string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
}

export default function ExplainThreadPanel({ conversationId }: { conversationId: string }) {
  const [isLoading, setIsLoading] = useState(false)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function explain() {
    if (isLoading) return
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${conversationId}/explain`, {
        method: "POST",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? "FlowDesk could not explain this thread.")
      }
      setExplanation(body.explanation)
    } catch (err) {
      setError(err instanceof Error ? err.message : "FlowDesk could not explain this thread.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Explain this thread</h2>
        {explanation ? (
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${RISK_BADGE[explanation.riskLevel]}`}
          >
            {explanation.riskLevel} risk
          </span>
        ) : null}
      </div>

      {!explanation ? (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Get a busy-person summary: what happened, what they want, what you need to do, and any
            risks or deadlines.
          </p>
          <button
            type="button"
            onClick={explain}
            disabled={isLoading}
            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Reading the thread..." : "Explain like I'm busy"}
          </button>
        </>
      ) : (
        <div className="space-y-3 text-xs">
          <Section title="What happened" body={explanation.whatHappened} />
          <Section title="What they want" body={explanation.whatTheyWant} />
          {explanation.whatYouNeedToDo.length > 0 ? (
            <SectionList title="What you need to do" items={explanation.whatYouNeedToDo} />
          ) : (
            <Section title="What you need to do" body="Nothing right now." />
          )}
          {explanation.risks.length > 0 ? (
            <SectionList title="Risks and deadlines" items={explanation.risks} accent />
          ) : null}
          {explanation.suggestedNextStep ? (
            <Section title="Suggested next step" body={explanation.suggestedNextStep} />
          ) : null}
          <button
            type="button"
            onClick={explain}
            disabled={isLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh explanation"}
          </button>
        </div>
      )}

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  )
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-600">{title}</h3>
      <p className="mt-0.5 text-slate-800">{body}</p>
    </div>
  )
}

function SectionList({
  title,
  items,
  accent = false,
}: {
  title: string
  items: string[]
  accent?: boolean
}) {
  return (
    <div className={accent ? "rounded-lg border border-amber-100 bg-amber-50 p-3" : undefined}>
      <h3 className={`font-semibold ${accent ? "text-amber-800" : "text-slate-600"}`}>{title}</h3>
      <ul className={`mt-1 list-disc space-y-1 pl-4 ${accent ? "text-amber-900" : "text-slate-800"}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
