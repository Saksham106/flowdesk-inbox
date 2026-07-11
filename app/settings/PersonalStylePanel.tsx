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
  lastTrainingTokens?: number | null
  lastTrainingStatus?: string | null
  lastTrainingAt?: string | Date | null
}

interface WritingPreferences {
  forbidEmDash: boolean
  preferredGreetings: string[]
  avoidedPhrases: string[]
  preferredSignoffs: string[]
  formality: string | null
  replyLength: string | null
  customInstruction: string | null
}

export default function PersonalStylePanel({
  initial,
  initialWritingPreferences,
}: {
  initial: PersonalProfile | null
  initialWritingPreferences: WritingPreferences | null
}) {
  const router = useRouter()
  const [training, setTraining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [writingPreferences, setWritingPreferences] = useState<WritingPreferences>(
    initialWritingPreferences ?? {
      forbidEmDash: false,
      preferredGreetings: [],
      avoidedPhrases: [],
      preferredSignoffs: [],
      formality: null,
      replyLength: null,
      customInstruction: null,
    }
  )
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [preferencesSaved, setPreferencesSaved] = useState(false)

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

  async function saveWritingPreferences() {
    setSavingPreferences(true)
    setPreferencesSaved(false)
    setError(null)
    try {
      const response = await fetch("/api/writing-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(writingPreferences),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Unable to save writing preferences")
      setWritingPreferences(data.preferences)
      setPreferencesSaved(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save writing preferences")
    } finally {
      setSavingPreferences(false)
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
  const lastTrainingTokens = initial?.lastTrainingTokens ?? null

  function updatePreferenceList(
    field: "preferredGreetings" | "avoidedPhrases" | "preferredSignoffs",
    value: string
  ) {
    const entries = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))]
    setWritingPreferences((current) => ({ ...current, [field]: entries }))
    setPreferencesSaved(false)
  }

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
              {lastTrainingTokens != null && (
                <p className="text-xs text-slate-500">
                  Last run used about {lastTrainingTokens.toLocaleString()} tokens
                  {initial?.lastTrainingStatus ? ` (${initial.lastTrainingStatus})` : ""}
                </p>
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
        {training ? "Learning from your recent sent emails..." : "Train Style"}
      </button>

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-medium text-slate-900">Writing preferences</h3>
        <p className="mt-1 text-sm text-slate-500">
          These choices override learned style when FlowDesk drafts a reply.
        </p>
        <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 text-sm font-medium text-slate-800">
          <span>Never use em dashes</span>
          <input
            type="checkbox"
            checked={writingPreferences.forbidEmDash}
            onChange={(event) => {
              setWritingPreferences((current) => ({ ...current, forbidEmDash: event.target.checked }))
              setPreferencesSaved(false)
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          Preferred greetings
          <input
            type="text"
            value={writingPreferences.preferredGreetings.join(", ")}
            onChange={(event) => updatePreferenceList("preferredGreetings", event.target.value)}
            placeholder="Hi, Hello"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Separate options with commas.</span>
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          Phrases to avoid
          <input
            type="text"
            value={writingPreferences.avoidedPhrases.join(", ")}
            onChange={(event) => updatePreferenceList("avoidedPhrases", event.target.value)}
            placeholder="circle back, touch base"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Separate options with commas.</span>
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          Preferred sign-offs
          <input
            type="text"
            value={writingPreferences.preferredSignoffs.join(", ")}
            onChange={(event) => updatePreferenceList("preferredSignoffs", event.target.value)}
            placeholder="Thanks, Best"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Separate options with commas.</span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Formality
            <select
              value={writingPreferences.formality ?? ""}
              onChange={(event) => {
                setWritingPreferences((current) => ({ ...current, formality: event.target.value || null }))
                setPreferencesSaved(false)
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              <option value="">Use learned style</option>
              <option value="casual">Casual</option>
              <option value="semi-formal">Semi-formal</option>
              <option value="formal">Formal</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Reply length
            <select
              value={writingPreferences.replyLength ?? ""}
              onChange={(event) => {
                setWritingPreferences((current) => ({ ...current, replyLength: event.target.value || null }))
                setPreferencesSaved(false)
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            >
              <option value="">Use learned style</option>
              <option value="brief">Brief</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          Additional drafting instruction
          <textarea
            value={writingPreferences.customInstruction ?? ""}
            onChange={(event) => {
              setWritingPreferences((current) => ({ ...current, customInstruction: event.target.value || null }))
              setPreferencesSaved(false)
            }}
            maxLength={1000}
            rows={3}
            placeholder="For example: Keep replies direct and avoid buzzwords."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          />
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={saveWritingPreferences}
            disabled={savingPreferences}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {savingPreferences ? "Saving..." : "Save writing preferences"}
          </button>
          {preferencesSaved && <span className="text-sm text-green-700">Saved</span>}
        </div>
      </div>
    </div>
  )
}
