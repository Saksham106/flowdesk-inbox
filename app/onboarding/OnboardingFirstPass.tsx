"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

type Sample = {
  conversationId: string
  from: string
  subject: string
  labels: string[]
}

type FirstPassResult = {
  hadGmail: boolean
  belowAutomationLevel: boolean
  minAutomationLevel: number
  organizedCount: number
  byLabel: Record<string, number>
  samples: Sample[]
  errors: number
}

// Tailwind chip styles per FlowDesk label, matching the in-app badge palette.
const LABEL_CHIP: Record<string, string> = {
  "Needs Reply": "bg-red-100 text-red-700",
  "Needs Action": "bg-orange-100 text-orange-700",
  "Waiting On": "bg-indigo-100 text-indigo-700",
  "Read Later": "bg-violet-100 text-violet-700",
  Handled: "bg-slate-100 text-slate-600",
  Autodrafted: "bg-blue-100 text-blue-700",
  Newsletter: "bg-yellow-100 text-yellow-800",
  Marketing: "bg-rose-100 text-rose-700",
  Notification: "bg-cyan-100 text-cyan-700",
  Calendar: "bg-emerald-100 text-emerald-700",
}

function LabelChip({ label, count }: { label: string; count?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        LABEL_CHIP[label] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {label}
      {count !== undefined && <span className="opacity-60">{count}</span>}
    </span>
  )
}

export default function OnboardingFirstPass({ connectedEmail }: { connectedEmail: string | null }) {
  const [status, setStatus] = useState<"running" | "done" | "error">("running")
  const [result, setResult] = useState<FirstPassResult | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // Guard against double-invocation (React 18 strict mode mounts twice); the
    // endpoint is idempotent anyway, but one pass is enough.
    if (started.current) return
    started.current = true

    fetch("/api/connectors/gmail/first-pass", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`first-pass failed: ${res.status}`)
        return (await res.json()) as FirstPassResult
      })
      .then((data) => {
        setResult(data)
        setStatus("done")
      })
      .catch(() => setStatus("error"))
  }, [])

  const sortedLabels = result
    ? Object.entries(result.byLabel).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        {status === "running" && (
          <div className="text-center">
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-500" />
            <h1 className="text-2xl font-semibold text-slate-900">Organizing your inbox…</h1>
            <p className="mt-2 text-sm text-slate-500">
              FlowDesk is labeling your recent emails in Gmail
              {connectedEmail ? ` for ${connectedEmail}` : ""}. This takes a few seconds.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-slate-900">We hit a snag organizing your inbox</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your account is connected. You can run the organize pass again anytime from
              Settings → Gmail behavior → “Fix Gmail labels”.
            </p>
            <Link
              href="/inbox"
              className="mt-6 inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Go to your control room →
            </Link>
          </div>
        )}

        {status === "done" && result && (
          <div>
            {result.organizedCount > 0 ? (
              <>
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
                    ✓
                  </div>
                  <h1 className="text-3xl font-bold text-slate-900">
                    {result.organizedCount} email{result.organizedCount === 1 ? "" : "s"} organized
                  </h1>
                  <p className="mt-2 text-sm text-slate-500">
                    FlowDesk labeled your recent inbox in Gmail. Open Gmail and you’ll see the labels
                    on your threads — and it keeps organizing new mail automatically from here.
                  </p>
                </div>

                {sortedLabels.length > 0 && (
                  <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      What we applied
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {sortedLabels.map(([label, count]) => (
                        <LabelChip key={label} label={label} count={count} />
                      ))}
                    </div>
                  </div>
                )}

                {result.samples.length > 0 && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <p className="border-b border-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      A few examples
                    </p>
                    <ul className="divide-y divide-slate-50">
                      {result.samples.map((sample) => (
                        <li key={sample.conversationId} className="flex items-center gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{sample.from}</p>
                            <p className="truncate text-xs text-slate-500">{sample.subject}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {sample.labels.map((label) => (
                              <LabelChip key={label} label={label} />
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-slate-900">You’re all set</h1>
                <p className="mt-2 text-sm text-slate-500">
                  {result.belowAutomationLevel
                    ? "FlowDesk is connected but your automation level is set below applying Gmail labels. Raise it in Settings → Automation to let FlowDesk organize your inbox."
                    : !result.hadGmail
                      ? "Connect a Gmail account to let FlowDesk start organizing your inbox."
                      : "FlowDesk is connected and watching your inbox — new mail will be organized as it arrives."}
                </p>
              </div>
            )}

            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                href="/inbox"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Go to your control room →
              </Link>
              <a
                href="https://mail.google.com"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Open Gmail to see your labels
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
