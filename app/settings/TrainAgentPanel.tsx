"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

type AgentRule = {
  id: string
  plainText: string
  ruleType: string
  conditionsJson: Record<string, string>
  actionJson: Record<string, string>
  status: string
}

type PreviewResult = {
  compiled: { ruleType: string; conditionsJson: Record<string,unknown>; actionJson: Record<string,unknown>; confidence: number }
  affectedCount: number
  examples: string[]
  conflicts: { id: string; plainText: string }[]
}

const ATTENTION_LABELS: Record<string, string> = {
  needs_reply: "Reply needed", needs_action: "Needs action", review_soon: "Review soon",
  read_later: "Read later", waiting_on: "Waiting on", fyi_done: "FYI / Done", quiet: "Quiet",
}

export default function TrainAgentPanel({ initialRules }: { initialRules: AgentRule[] }) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const [input, setInput] = useState("")
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreview() {
    if (!input.trim()) return
    setPreviewing(true)
    setError(null)
    setPreview(null)
    try {
      const res = await fetch("/api/agent-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plainText: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Preview failed")
      setPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSave() {
    if (!input.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/agent-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plainText: input }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save rule")
      setRules((prev) => [data.rule, ...prev])
      setInput("")
      setPreview(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handlePause(id: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "paused" : "active"
    await fetch(`/api/agent-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus } : r))
  }

  async function handleDelete(id: string) {
    await fetch(`/api/agent-rules/${id}`, { method: "DELETE" })
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Describe a rule in plain English</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setPreview(null) }}
            placeholder='e.g. "Move all emails from amazon.com to read later"'
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            onKeyDown={(e) => e.key === "Enter" && handlePreview()}
          />
          <button
            onClick={handlePreview}
            disabled={!input.trim() || previewing}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {previewing ? "..." : "Preview"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2 text-sm">
          <p className="font-medium text-blue-900">
            Rule understood &mdash; affects {preview.affectedCount} emails in the last 90 days
          </p>
          {preview.examples.length > 0 && (
            <ul className="list-disc list-inside text-blue-700 text-xs">
              {preview.examples.map((ex, i) => <li key={i}>{ex}</li>)}
            </ul>
          )}
          {preview.conflicts.length > 0 && (
            <p className="text-amber-700 text-xs font-medium">
              Conflicts with existing rule: &ldquo;{preview.conflicts[0].plainText}&rdquo;
            </p>
          )}
          {preview.compiled.confidence < 0.5 && (
            <p className="text-red-700 text-xs">Low confidence &mdash; try rephrasing more specifically.</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || preview.compiled.confidence < 0.4}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Add rule"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {rules.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Active rules</p>
          <div className="space-y-1">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{rule.plainText}</p>
                  <p className="text-xs text-slate-400">
                    {rule.conditionsJson.matchType} {rule.conditionsJson.matchValue}
                    {" → "}
                    {ATTENTION_LABELS[rule.actionJson.targetAttention] ?? rule.actionJson.targetAttention}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handlePause(rule.id, rule.status)}
                    className="text-xs text-slate-400 hover:text-slate-700"
                  >
                    {rule.status === "active" ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
