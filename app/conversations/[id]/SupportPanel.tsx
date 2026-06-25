"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type SupportPanelProps = {
  conversationId: string
  isSupport: boolean
  churnRisk: boolean
  needsEscalation: boolean
  suggestedKbDoc: {
    id: string
    title: string
    content: string
    sourceType: string
  } | null
  repeatContactCount: number
}

export default function SupportPanel({
  conversationId,
  isSupport,
  churnRisk,
  needsEscalation,
  suggestedKbDoc,
  repeatContactCount,
}: SupportPanelProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [useAnswerLoading, setUseAnswerLoading] = useState(false)

  if (!isSupport) return null

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-blue-100 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Support
        </span>
        {churnRisk && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Churn Risk
          </span>
        )}
        {needsEscalation && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Needs Escalation
          </span>
        )}
        {repeatContactCount > 1 && (
          <span className="ml-auto text-xs text-slate-500">
            {repeatContactCount} support threads from this contact
          </span>
        )}
      </div>

      {suggestedKbDoc && (
        <div className="px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-blue-800">Suggested answer from KB:</p>
          <p className="text-xs font-semibold text-slate-800">{suggestedKbDoc.title}</p>
          <p className="mt-1 line-clamp-3 text-xs text-slate-600">
            {expanded
              ? suggestedKbDoc.content
              : suggestedKbDoc.content.slice(0, 300) +
                (suggestedKbDoc.content.length > 300 ? "…" : "")}
          </p>
          {suggestedKbDoc.content.length > 300 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs text-blue-600 hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          <button
            onClick={async () => {
              if (useAnswerLoading) return
              setUseAnswerLoading(true)
              const res = await fetch(`/api/conversations/${conversationId}/draft`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: suggestedKbDoc.content,
                  status: "proposed",
                  kbDocId: suggestedKbDoc.id,
                }),
              })
              setUseAnswerLoading(false)
              if (res.ok) router.refresh()
            }}
            disabled={useAnswerLoading}
            className="mt-3 block rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60 disabled:cursor-wait"
          >
            {useAnswerLoading ? "Applying…" : "Use this answer"}
          </button>
        </div>
      )}
    </section>
  )
}
