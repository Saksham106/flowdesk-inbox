"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { plannedLabelsForRuleAction } from "@/lib/assistant-rule-view"

type SenderRule = {
  id: string
  matchType: string
  matchValue: string
  targetAttention: string
  status: string
  triggerCount: number
}

type StaticRule = {
  id: string
  plainText: string
  conditionsJson: Record<string, string>
  actionJson: Record<string, string>
  status: string
  version: number
  lastDryRunAt: string | null
}

type DryRunResult = {
  sampleSize: number
  matchedCount: number
  skippedCount: number
  matches: Array<{ conversationId: string; fromEmail: string; subject: string; evidence: string[] }>
  plannedAction: { targetAttention: string; gmailLabels: string[] } | null
  automationLevel: number
  wouldApplyGmailLabels: boolean
}

type RuleVersion = {
  version: number | null
  plainText: string | null
  conditionsJson: Record<string, string> | null
  actionJson: Record<string, string> | null
  snapshotAt: string
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

const EMPTY_FORM = {
  matchType: "domain",
  matchValue: "",
  subjectContains: "",
  bodyContains: "",
  targetAttention: "read_later",
}

function describeConditions(c: Record<string, string>): string {
  const parts: string[] = []
  if (c.matchType === "email" && c.matchValue) parts.push(`from ${c.matchValue}`)
  if (c.matchType === "domain" && c.matchValue) parts.push(`from @${c.matchValue}`)
  if (c.subjectContains) parts.push(`subject has "${c.subjectContains}"`)
  if (c.bodyContains) parts.push(`body has "${c.bodyContains}"`)
  return parts.join(", ")
}

export default function SenderRulesPanel({
  initialRules,
  initialStaticRules,
}: {
  initialRules: SenderRule[]
  initialStaticRules: StaticRule[]
}) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const [staticRules, setStaticRules] = useState(initialStaticRules)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dryRuns, setDryRuns] = useState<Record<string, DryRunResult>>({})
  const [versions, setVersions] = useState<Record<string, RuleVersion[] | null>>({})

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

  async function createStaticRule() {
    setError(null)
    setPending((p) => ({ ...p, create: true }))
    try {
      const conditions: Record<string, string> = {}
      if (form.matchValue.trim()) {
        conditions.matchType = form.matchType
        conditions.matchValue = form.matchValue.trim()
      }
      if (form.subjectContains.trim()) conditions.subjectContains = form.subjectContains.trim()
      if (form.bodyContains.trim()) conditions.bodyContains = form.bodyContains.trim()

      const res = await fetch("/api/agent-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions, action: { targetAttention: form.targetAttention } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create rule")
      setStaticRules((prev) => [{ ...data.rule, lastDryRunAt: null }, ...prev])
      setForm(EMPTY_FORM)
      setShowForm(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule")
    } finally {
      setPending((p) => ({ ...p, create: false }))
    }
  }

  async function runDryRun(ruleId: string) {
    setError(null)
    setPending((p) => ({ ...p, [ruleId]: true }))
    try {
      const res = await fetch("/api/agent-rules/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Dry-run failed")
      setDryRuns((prev) => ({ ...prev, [ruleId]: data }))
      setStaticRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, lastDryRunAt: new Date().toISOString() } : r))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dry-run failed")
    } finally {
      setPending((p) => ({ ...p, [ruleId]: false }))
    }
  }

  async function setStaticStatus(ruleId: string, status: "active" | "paused" | "dismissed") {
    setError(null)
    setPending((p) => ({ ...p, [ruleId]: true }))
    try {
      const res = await fetch(`/api/agent-rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to update rule")
      setStaticRules((prev) =>
        status === "dismissed"
          ? prev.filter((r) => r.id !== ruleId)
          : prev.map((r) => (r.id === ruleId ? { ...r, status } : r))
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule")
    } finally {
      setPending((p) => ({ ...p, [ruleId]: false }))
    }
  }

  async function toggleVersions(ruleId: string) {
    if (versions[ruleId] !== undefined) {
      setVersions((prev) => {
        const next = { ...prev }
        delete next[ruleId]
        return next
      })
      return
    }
    setVersions((prev) => ({ ...prev, [ruleId]: null }))
    const res = await fetch(`/api/agent-rules/${ruleId}/versions`)
    if (res.ok) {
      const data = await res.json()
      setVersions((prev) => ({ ...prev, [ruleId]: data.versions ?? [] }))
    }
  }

  const formHasCondition =
    form.matchValue.trim() || form.subjectContains.trim() || form.bodyContains.trim()

  return (
    <div className="space-y-6">
      {/* Static rules: deterministic sender/domain/subject/body conditions
          that run before any AI classification. */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Static rules (run before AI)
          </p>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {showForm ? "Cancel" : "New rule"}
          </button>
        </div>

        {showForm && (
          <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex gap-2">
              <select
                value={form.matchType}
                onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="domain">Sender domain</option>
                <option value="email">Sender email</option>
              </select>
              <input
                type="text"
                value={form.matchValue}
                onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
                placeholder={form.matchType === "email" ? "person@example.com" : "example.com"}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.subjectContains}
                onChange={(e) => setForm((f) => ({ ...f, subjectContains: e.target.value }))}
                placeholder="Subject contains (optional)"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
              <input
                type="text"
                value={form.bodyContains}
                onChange={(e) => setForm((f) => ({ ...f, bodyContains: e.target.value }))}
                placeholder="Body contains (optional)"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Then mark as</span>
              <select
                value={form.targetAttention}
                onChange={(e) => setForm((f) => ({ ...f, targetAttention: e.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              >
                {Object.entries(ATTENTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                onClick={createStaticRule}
                disabled={!formHasCondition || pending.create}
                className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {pending.create ? "…" : "Create draft"}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              New rules start as drafts. Preview a rule against your recent mail before enabling it —
              a dry-run changes nothing in Gmail.
            </p>
          </div>
        )}

        {staticRules.length === 0 && !showForm && (
          <p className="text-sm text-slate-400">
            No static rules yet. Static rules match sender, domain, subject, or body text and run
            before any AI classification.
          </p>
        )}

        <div className="space-y-2">
          {staticRules.map((rule) => {
            const dryRun = dryRuns[rule.id]
            const canEnable = rule.status !== "active" && Boolean(rule.lastDryRunAt || dryRun)
            const ruleVersions = versions[rule.id]
            const plannedLabels = plannedLabelsForRuleAction(rule.actionJson)
            return (
              <div key={rule.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">
                      {describeConditions(rule.conditionsJson) || rule.plainText}
                      {" → "}
                      <span className="font-medium">
                        {ATTENTION_LABELS[rule.actionJson.targetAttention] ?? rule.actionJson.targetAttention}
                      </span>
                      {plannedLabels.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          {plannedLabels.map((label) => (
                            <span
                              key={label}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                            >
                              → {label}
                            </span>
                          ))}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {rule.status === "draft" && (
                        <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                          Draft
                        </span>
                      )}
                      {rule.status === "paused" && (
                        <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                          Paused
                        </span>
                      )}
                      {rule.status === "active" && (
                        <span className="mr-2 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">
                          Active
                        </span>
                      )}
                      v{rule.version}
                      <button
                        onClick={() => toggleVersions(rule.id)}
                        className="ml-2 text-slate-400 underline hover:text-slate-600"
                      >
                        history
                      </button>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => runDryRun(rule.id)}
                      disabled={pending[rule.id]}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {pending[rule.id] ? "…" : "Preview"}
                    </button>
                    {rule.status === "active" ? (
                      <button
                        onClick={() => setStaticStatus(rule.id, "paused")}
                        disabled={pending[rule.id]}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={() => setStaticStatus(rule.id, "active")}
                        disabled={pending[rule.id] || !canEnable}
                        title={canEnable ? undefined : "Preview this rule before enabling it"}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        Enable
                      </button>
                    )}
                    <button
                      onClick={() => setStaticStatus(rule.id, "dismissed")}
                      disabled={pending[rule.id]}
                      className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {rule.status !== "active" && !canEnable && (
                  <p className="mt-2 text-xs text-amber-600">
                    Run a preview before enabling — you&apos;ll see exactly what this rule would do.
                  </p>
                )}

                {dryRun && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="font-medium text-slate-900">
                      Dry-run over your last {dryRun.sampleSize} conversations: {dryRun.matchedCount}{" "}
                      matched, {dryRun.skippedCount} skipped. Nothing was changed.
                    </p>
                    {dryRun.plannedAction && (
                      <p className="mt-1 text-slate-800">
                        On match: mark as{" "}
                        {ATTENTION_LABELS[dryRun.plannedAction.targetAttention] ??
                          dryRun.plannedAction.targetAttention}
                        {dryRun.plannedAction.gmailLabels.length > 0 && (
                          <> and apply {dryRun.plannedAction.gmailLabels.join(", ")}</>
                        )}
                        {!dryRun.wouldApplyGmailLabels && (
                          <span className="text-slate-600">
                            {" "}
                            (Gmail labels are off at automation level {dryRun.automationLevel})
                          </span>
                        )}
                      </p>
                    )}
                    {dryRun.matches.length > 0 && (
                      <ul className="mt-2 space-y-1 text-slate-700">
                        {dryRun.matches.slice(0, 5).map((m) => (
                          <li key={m.conversationId}>
                            <span className="font-mono">{m.fromEmail}</span>
                            {m.subject ? ` — ${m.subject}` : ""}
                            <span className="text-slate-500"> ({m.evidence.join("; ")})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {ruleVersions !== undefined && (
                  <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                    {ruleVersions === null ? (
                      "Loading history…"
                    ) : ruleVersions.length === 0 ? (
                      "No earlier versions."
                    ) : (
                      <ul className="space-y-1">
                        {ruleVersions.map((v, i) => (
                          <li key={i}>
                            v{v.version}: {describeConditions(v.conditionsJson ?? {}) || v.plainText}
                            {" → "}
                            {v.actionJson?.targetAttention}
                            <span className="text-slate-400">
                              {" "}
                              (until {new Date(v.snapshotAt).toLocaleDateString()})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

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
            Learned sender rules
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
