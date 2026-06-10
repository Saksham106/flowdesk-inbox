"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface PersonalProfile {
  toneSummary?: string | null
  greetingPatterns?: string | null
  signoffPatterns?: string | null
  sentenceLengthStyle?: string | null
  formalityLevel?: string | null
  recurringPhrasesToUse?: string[]
  recurringPhrasesToAvoid?: string[]
  sanitizedExamples?: string | null
  sampleCount?: number | null
  lastTrainedAt?: string | Date | null
}

export default function PersonalStylePanel({
  initial,
}: {
  initial: PersonalProfile | null
}) {
  const router = useRouter()
  const [training, setTraining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  async function handleTrain() {
    setTraining(true)
    setError(null)
    try {
      const res = await fetch("/api/personal-profile/train", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Training failed")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Training failed")
    } finally {
      setTraining(false)
    }
  }

  const lastTrainedAt = initial?.lastTrainedAt
    ? new Date(initial.lastTrainedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null

  const phrasesToUse = initial?.recurringPhrasesToUse ?? []
  const phrasesToAvoid = initial?.recurringPhrasesToAvoid ?? []

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!initial ? (
        <p className="text-sm text-slate-500">
          No style profile yet. Connect Gmail and click Train to learn your writing style.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-medium">
                {initial.sampleCount != null ? initial.sampleCount : 0} emails analyzed
              </p>
              {lastTrainedAt && (
                <p className="text-xs text-slate-500">Last trained {lastTrainedAt}</p>
              )}
            </div>
            {initial.toneSummary && (
              <button
                type="button"
                onClick={() => setSummaryExpanded((v) => !v)}
                className="shrink-0 text-xs text-slate-500 underline hover:text-slate-700"
              >
                {summaryExpanded ? "Hide summary" : "Preview summary"}
              </button>
            )}
          </div>

          {summaryExpanded && initial.toneSummary && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {initial.toneSummary}
            </div>
          )}

          {/* Profile details */}
          <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-4">
            {initial.formalityLevel && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Formality</span>
                <span className="text-slate-700">{initial.formalityLevel}</span>
              </div>
            )}
            {initial.sentenceLengthStyle && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Sentence style</span>
                <span className="text-slate-700">{initial.sentenceLengthStyle}</span>
              </div>
            )}
            {initial.greetingPatterns && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Greeting style</span>
                <span className="text-slate-700">{initial.greetingPatterns}</span>
              </div>
            )}
            {initial.signoffPatterns && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Sign-off style</span>
                <span className="text-slate-700">{initial.signoffPatterns}</span>
              </div>
            )}
            {phrasesToUse.length > 0 && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Phrases to use</span>
                <span className="text-slate-700">{phrasesToUse.join(", ")}</span>
              </div>
            )}
            {phrasesToAvoid.length > 0 && (
              <div className="flex gap-2 text-sm">
                <span className="w-36 shrink-0 text-xs font-medium text-slate-500">Phrases to avoid</span>
                <span className="text-slate-700">{phrasesToAvoid.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleTrain}
        disabled={training}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {training ? "Training..." : "Train Style"}
      </button>
    </div>
  )
}
