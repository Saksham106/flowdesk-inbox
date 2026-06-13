"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import type {
  CommandCenterConversation,
  RelationshipContext,
} from "@/lib/agent/command-center"

export default function HandleThisPanel({
  conversationId,
  assistantState,
  relationshipContext,
  canSuggest,
  isPersonal = false,
}: {
  conversationId: string
  assistantState: CommandCenterConversation
  relationshipContext: RelationshipContext
  canSuggest: boolean
  isPersonal?: boolean
}) {
  const router = useRouter()
  const [isHandling, setIsHandling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleThis() {
    if (!canSuggest || isHandling) return

    setIsHandling(true)
    setNotice(null)
    setError(null)

    try {
      const response = await fetch(`/api/conversations/${conversationId}/draft/suggest`, {
        method: "POST",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? "FlowDesk could not handle this yet.")
      }
      setNotice("Handled: draft and next-step context are ready for review.")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "FlowDesk could not handle this yet.")
    } finally {
      setIsHandling(false)
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">Assistant context</h2>
          <p className="mt-1 min-w-0 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">{assistantState.reason}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
          {assistantState.state.replaceAll("_", " ")}
        </span>
      </div>

      <button
        type="button"
        onClick={handleThis}
        disabled={!canSuggest || isHandling}
        className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isHandling ? "Handling..." : "Handle this"}
      </button>

      {!canSuggest ? (
        <p className="mt-2 text-xs text-amber-700">
          {isPersonal
            ? "Complete your profile in Settings before FlowDesk can draft a response."
            : "Add a business profile in Settings before FlowDesk can draft a handled response."}
        </p>
      ) : null}
      {notice ? <p className="mt-2 text-sm text-green-700">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      <dl className="mt-4 space-y-3 text-xs">
        <ContextRow label="Next action" value={assistantState.nextAction} />
        {assistantState.approvalReason ? (
          <ContextRow label="Review note" value={assistantState.approvalReason} />
        ) : null}
        <ContextRow label="Person" value={relationshipContext.name} />
        <ContextRow label="Summary" value={relationshipContext.lastConversationSummary} />
        <ContextRow label="Relationship" value={relationshipContext.relationshipStatus} />
        <ContextRow label="Tone" value={relationshipContext.tonePreference} />
      </dl>

      {relationshipContext.openTasks.length > 0 ? (
        <ContextList title="Open tasks" items={relationshipContext.openTasks} />
      ) : null}
      {relationshipContext.moneySignals.length > 0 ? (
        <ContextList title="Money signals" items={relationshipContext.moneySignals} />
      ) : null}
      {relationshipContext.importantDetails.length > 0 ? (
        <ContextList title="Details" items={relationshipContext.importantDetails} />
      ) : null}
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-slate-800 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <h3 className="text-xs font-semibold text-slate-600">{title}</h3>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {items.map((item) => (
          <li key={item} className="min-w-0 break-words [overflow-wrap:anywhere]">{item}</li>
        ))}
      </ul>
    </div>
  )
}
