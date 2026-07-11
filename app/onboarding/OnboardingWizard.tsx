"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import type { OnboardingStep } from "@/lib/onboarding"

type Sample = {
  conversationId: string
  from: string
  subject: string
  labels: string[]
}

type FirstPassResult = {
  hadEmailChannel: boolean
  belowAutomationLevel: boolean
  minAutomationLevel: number
  organizedCount: number
  byLabel: Record<string, number>
  samples: Sample[]
  errors: number
}

type StyleSummary = {
  tone: string | null
  greetings: string | null
  signoffs: string | null
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

const STEP_LABELS = ["Connect your inbox", "Train your style"]

function stepIndex(step: OnboardingStep): number {
  if (step === "connect" || step === "firstPass") return 0
  if (step === "train") return 1
  return 2
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-10 flex items-center justify-center">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center">
          {i > 0 && (
            <div className={`mx-3 h-px w-10 ${current > i - 1 ? "bg-blue-500" : "bg-slate-200"}`} />
          )}
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                current > i
                  ? "bg-blue-600 text-white"
                  : current === i
                    ? "border-2 border-blue-600 bg-white text-blue-600"
                    : "border border-slate-300 bg-white text-slate-400"
              }`}
            >
              {current > i ? "✓" : i + 1}
            </span>
            <span
              className={`text-sm font-medium ${current >= i ? "text-slate-800" : "text-slate-400"}`}
            >
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
    />
  )
}

export default function OnboardingWizard({
  initialStep,
  connectedEmail,
  styleTrained,
  microsoftConfigured = false,
}: {
  initialStep: OnboardingStep
  connectedEmail: string | null
  styleTrained: boolean
  microsoftConfigured?: boolean
}) {
  const [step, setStep] = useState<OnboardingStep>(initialStep)

  // The outlook callback passes `connected=outlook` as a provider marker (not
  // a real address, unlike the gmail callback's `connected=<email>`) so the
  // wizard can tell which provider was just connected without a real email to
  // sniff. Anything else — including null — is treated as gmail, which keeps
  // this component's output unchanged for every existing (non-outlook) flow.
  const connectedProvider: "gmail" | "outlook" = connectedEmail === "outlook" ? "outlook" : "gmail"

  // ── First-pass state (step 1 completion) ──
  const [firstPassStatus, setFirstPassStatus] = useState<"running" | "done" | "error">("running")
  const [firstPass, setFirstPass] = useState<FirstPassResult | null>(null)
  const firstPassStarted = useRef(false)

  // ── Training state (step 2) ──
  const [trainStatus, setTrainStatus] = useState<"idle" | "running" | "done" | "error">("idle")
  const [trainError, setTrainError] = useState<string | null>(null)
  const [style, setStyle] = useState<StyleSummary | null>(null)

  useEffect(() => {
    if (step !== "firstPass") return
    // Guard against double-invocation (React 18 strict mode mounts twice); the
    // endpoint is idempotent anyway, but one pass is enough.
    if (firstPassStarted.current) return
    firstPassStarted.current = true

    fetch("/api/connectors/gmail/first-pass", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`first-pass failed: ${res.status}`)
        return (await res.json()) as FirstPassResult
      })
      .then((data) => {
        setFirstPass(data)
        setFirstPassStatus("done")
      })
      .catch(() => setFirstPassStatus("error"))
  }, [step])

  function afterFirstPass() {
    setStep(styleTrained ? "done" : "train")
  }

  async function trainStyle() {
    setTrainStatus("running")
    setTrainError(null)
    try {
      const res = await fetch("/api/personal-profile/train", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Training failed")
      const summary =
        typeof data.profile?.styleSummaryJson === "object" && data.profile?.styleSummaryJson !== null
          ? (data.profile.styleSummaryJson as Record<string, unknown>)
          : {}
      setStyle({
        tone: typeof summary.tone === "string" ? summary.tone : null,
        greetings: typeof summary.greetings === "string" ? summary.greetings : null,
        signoffs: typeof summary.signoffs === "string" ? summary.signoffs : null,
      })
      setTrainStatus("done")
    } catch (err) {
      setTrainError(err instanceof Error ? err.message : "Training failed")
      setTrainStatus("error")
    }
  }

  const sortedLabels = firstPass
    ? Object.entries(firstPass.byLabel).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <StepIndicator current={stepIndex(step)} />

        {/* ── Step 1: Connect Gmail ── */}
        {step === "connect" && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl">
              ✉️
            </div>
            <h1 className="text-3xl font-bold text-slate-900">
              {microsoftConfigured ? "Connect your inbox" : "Connect your Gmail"}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
              FlowDesk organizes your inbox with labels, drafts replies in your voice, and keeps
              watch so nothing slips. It starts by connecting to your{" "}
              {microsoftConfigured ? "Gmail or Outlook account" : "Gmail account"}.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <a
                href="/api/connectors/gmail/connect"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Connect Gmail →
              </a>
              {microsoftConfigured && (
                <a
                  href="/api/connectors/outlook/connect"
                  className="inline-flex w-full max-w-xs items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Connect Outlook →
                </a>
              )}
              <Link href="/home" className="text-xs font-medium text-slate-500 hover:text-slate-700">
                Skip for now
              </Link>
            </div>
            <p className="mt-6 text-xs text-slate-400">
              You can disconnect anytime from Settings. FlowDesk only touches labels and drafts —
              it never sends without your say-so.
            </p>
          </div>
        )}

        {/* ── Step 1 completion: first pass over the existing inbox ── */}
        {step === "firstPass" && (
          <div>
            {firstPassStatus === "running" && (
              <div className="text-center">
                <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-500" />
                <h1 className="text-2xl font-semibold text-slate-900">Organizing your inbox…</h1>
                <p className="mt-2 text-sm text-slate-500">
                  FlowDesk is labeling your recent emails
                  {connectedProvider === "outlook"
                    ? " in Outlook"
                    : ` in Gmail${connectedEmail ? ` for ${connectedEmail}` : ""}`}
                  . This takes a few seconds.
                </p>
              </div>
            )}

            {firstPassStatus === "error" && (
              <div className="text-center">
                <h1 className="text-2xl font-semibold text-slate-900">
                  We hit a snag organizing your inbox
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  Your account is connected. You can run the organize pass again anytime from
                  Settings → Gmail behavior → “Fix Gmail labels”.
                </p>
                <div className="mt-8 flex justify-center">
                  <PrimaryButton onClick={afterFirstPass}>Continue →</PrimaryButton>
                </div>
              </div>
            )}

            {firstPassStatus === "done" && firstPass && (
              <div>
                {firstPass.organizedCount > 0 ? (
                  <>
                    <div className="text-center">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
                        ✓
                      </div>
                      <h1 className="text-3xl font-bold text-slate-900">
                        {firstPass.organizedCount} email{firstPass.organizedCount === 1 ? "" : "s"} organized
                      </h1>
                      <p className="mt-2 text-sm text-slate-500">
                        FlowDesk labeled your recent inbox
                        {connectedProvider === "outlook" ? " in Outlook" : " in Gmail"}. Open your
                        inbox and you’ll see the labels on your threads — and it keeps organizing
                        new mail automatically from here.
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

                    {firstPass.samples.length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <p className="border-b border-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          A few examples
                        </p>
                        <ul className="divide-y divide-slate-50">
                          {firstPass.samples.map((sample) => (
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
                    <h1 className="text-2xl font-semibold text-slate-900">
                      {connectedProvider === "outlook" ? "Outlook connected" : "Gmail connected"}
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                      {firstPass.belowAutomationLevel
                        ? "FlowDesk is connected but your automation level is set below applying labels. Raise it in Settings → Automation to let FlowDesk organize your inbox."
                        : !firstPass.hadEmailChannel
                          ? "Connect an email account to let FlowDesk start organizing your inbox."
                          : "FlowDesk is connected and watching your inbox — new mail will be organized as it arrives."}
                    </p>
                  </div>
                )}

                <div className="mt-8 flex justify-center">
                  <PrimaryButton onClick={afterFirstPass}>Continue →</PrimaryButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Train your style ── */}
        {step === "train" && (
          <div className="text-center">
            {trainStatus === "running" ? (
              <>
                <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-500" />
                <h1 className="text-2xl font-semibold text-slate-900">Reading your sent mail…</h1>
                <p className="mt-2 text-sm text-slate-500">
                  FlowDesk is learning your tone, greetings, and sign-offs so drafts sound like
                  you. This takes under a minute.
                </p>
              </>
            ) : trainStatus === "done" ? (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
                  ✓
                </div>
                <h1 className="text-3xl font-bold text-slate-900">Style learned</h1>
                <p className="mt-2 text-sm text-slate-500">
                  Drafts will now sound like you. You can retrain or fine-tune anytime in
                  Settings → Training.
                </p>
                {style && (style.tone || style.greetings || style.signoffs) && (
                  <div className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-5 text-left">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      What we learned
                    </p>
                    <dl className="space-y-2 text-sm">
                      {style.tone && (
                        <div>
                          <dt className="font-medium text-slate-800">Tone</dt>
                          <dd className="text-slate-500">{style.tone}</dd>
                        </div>
                      )}
                      {style.greetings && (
                        <div>
                          <dt className="font-medium text-slate-800">Greetings</dt>
                          <dd className="text-slate-500">{style.greetings}</dd>
                        </div>
                      )}
                      {style.signoffs && (
                        <div>
                          <dt className="font-medium text-slate-800">Sign-offs</dt>
                          <dd className="text-slate-500">{style.signoffs}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}
                <div className="mt-8 flex justify-center">
                  <PrimaryButton onClick={() => setStep("done")}>Continue →</PrimaryButton>
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl">
                  ✍️
                </div>
                <h1 className="text-3xl font-bold text-slate-900">Train your writing style</h1>
                <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
                  FlowDesk reads a sample of your sent emails to learn how you write — tone,
                  greetings, sign-offs — so its drafts sound like you, not a robot.
                </p>
                {trainStatus === "error" && trainError && (
                  <p className="mx-auto mt-4 max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                    {trainError}
                  </p>
                )}
                <div className="mt-8 flex flex-col items-center gap-3">
                  <PrimaryButton onClick={trainStyle}>
                    {trainStatus === "error" ? "Try again" : "Learn my style"}
                  </PrimaryButton>
                  <button
                    onClick={() => setStep("done")}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    Skip for now
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Finish ── */}
        {step === "done" && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              🎉
            </div>
            <h1 className="text-3xl font-bold text-slate-900">You’re all set</h1>
            <p className="mt-2 text-sm text-slate-500">
              FlowDesk is watching your inbox — new mail gets organized automatically, and drafts
              are ready when you are.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                href="/home"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Go to your control room →
              </Link>
              <a
                href={connectedProvider === "outlook" ? "https://outlook.office.com/mail/" : "https://mail.google.com"}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Open your inbox to see your labels
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
