"use client"

import { useState } from "react"

export type RuleOption = {
  id: string
  label: string
}

type PlannedAction = {
  type: string
  targetAttention: string
  workflowStatus: string
  gmailLabels: string[]
} | null

type DryRunMatch = {
  conversationId: string
  fromEmail: string
  subject: string
  evidence: string[]
}

type DryRunResult = {
  ok: boolean
  ruleId: string | null
  ruleVersion: number | null
  sampleSize: number
  matchedCount: number
  skippedCount: number
  matches: DryRunMatch[]
  plannedAction: PlannedAction
  automationLevel: number
  wouldApplyGmailLabels: boolean
}

export default function TestRulesClient({ rules }: { rules: RuleOption[] }) {
  const [ruleId, setRuleId] = useState("")
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runDryRun() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agent-rules/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Dry-run failed")
        setResult(null)
      } else {
        setResult(data)
      }
    } catch {
      setError("Network error running dry-run")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Test Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Dry-run a saved rule against your recent conversations before enabling it.
      </p>
      <div className="flex gap-2">
        <select
          value={ruleId}
          onChange={(e) => setRuleId(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Select a rule</option>
          {rules.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runDryRun}
          disabled={!ruleId || loading}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Running…" : "Run dry-run"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Matched {result.matchedCount} of {result.sampleSize} sampled conversations
            ({result.skippedCount} skipped).
          </p>
          <p>Automation level: {result.automationLevel}</p>
          {result.plannedAction && (
            <p>
              Planned action: set attention to{" "}
              <span className="font-medium">{result.plannedAction.targetAttention}</span>
              {result.plannedAction.gmailLabels.length > 0 && (
                <> (Gmail labels: {result.plannedAction.gmailLabels.join(", ")})</>
              )}
            </p>
          )}
          <p>
            Would apply Gmail labels at current automation level:{" "}
            {result.wouldApplyGmailLabels ? "yes" : "no"}
          </p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {result.matches.map((m) => (
              <li key={m.conversationId} className="px-3 py-2">
                <div>
                  {m.subject || "(no subject)"} — {m.fromEmail}
                </div>
                {m.evidence.length > 0 && (
                  <div className="mt-1 text-xs text-slate-500">{m.evidence.join("; ")}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
