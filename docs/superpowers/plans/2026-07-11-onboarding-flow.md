# New-User Onboarding Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-step, skippable onboarding wizard at `/onboarding` (Connect Gmail → Train your style) that new signups land on.

**Architecture:** State-derived wizard — step completion comes from real rows (`Channel` type `email` = Gmail connected, `LearnedReplyProfile` = style trained), no schema change. The existing OAuth callback redirect to `/onboarding?connected=<email>` lands inside the wizard's first-pass sub-state. `OnboardingFirstPass.tsx` is absorbed into the new `OnboardingWizard.tsx` and deleted.

**Tech Stack:** Next.js App Router, Tailwind, Vitest, Prisma (reads only).

## Global Constraints

- Work in worktree `.worktrees/feat-onboarding-flow` (branch `feat-onboarding-flow`).
- Test runner is Vitest: `npx vitest run <file>`.
- Pre-PR checks: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- No Prisma schema changes.
- Sign-in redirect stays `/home`; only the signup path changes to `/onboarding`.

---

### Task 1: Step-resolution helper

**Files:**
- Create: `lib/onboarding.ts`
- Test: `tests/onboarding-step.test.ts`

**Interfaces:**
- Produces: `export type OnboardingStep = "connect" | "firstPass" | "train" | "done"` and `export function resolveOnboardingStep(input: { gmailConnected: boolean; styleTrained: boolean; justConnected: boolean }): OnboardingStep` — consumed by Task 2's `app/onboarding/page.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/onboarding-step.test.ts
import { describe, expect, it } from "vitest";

import { resolveOnboardingStep } from "@/lib/onboarding";

describe("resolveOnboardingStep", () => {
  it("starts at connect when nothing is set up", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: false, styleTrained: false, justConnected: false })
    ).toBe("connect");
  });

  it("runs the first pass right after an OAuth connect", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: false, justConnected: true })
    ).toBe("firstPass");
  });

  it("runs the first pass after a reconnect even if style is already trained", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: true, justConnected: true })
    ).toBe("firstPass");
  });

  it("resumes at train when Gmail is connected but style is untrained", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: false, justConnected: false })
    ).toBe("train");
  });

  it("is done when everything is set up", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: true, justConnected: false })
    ).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboarding-step.test.ts`
Expected: FAIL — cannot resolve `@/lib/onboarding`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/onboarding.ts
export type OnboardingStep = "connect" | "firstPass" | "train" | "done";

// Steps derive from real state (email channel row, learned reply profile row)
// so the wizard can never disagree with what's actually set up.
export function resolveOnboardingStep(input: {
  gmailConnected: boolean;
  styleTrained: boolean;
  justConnected: boolean;
}): OnboardingStep {
  if (input.justConnected) return "firstPass";
  if (!input.gmailConnected) return "connect";
  if (!input.styleTrained) return "train";
  return "done";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboarding-step.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding.ts tests/onboarding-step.test.ts
git commit -m "feat: onboarding step resolution helper"
```

---

### Task 2: Onboarding wizard component and page

**Files:**
- Create: `app/onboarding/OnboardingWizard.tsx`
- Modify: `app/onboarding/page.tsx` (full rewrite shown below)
- Delete: `app/onboarding/OnboardingFirstPass.tsx`

**Interfaces:**
- Consumes: `resolveOnboardingStep`, `OnboardingStep` from `lib/onboarding.ts` (Task 1); `POST /api/connectors/gmail/first-pass` (existing, returns `FirstPassResult` JSON); `POST /api/personal-profile/train` (existing, returns `{ profile }` where `profile.styleSummaryJson` has string fields `tone`, `greetings`, `signoffs`); `GET /api/connectors/gmail/connect` (existing OAuth redirect).
- Produces: `OnboardingWizard` client component with props `{ initialStep: OnboardingStep; connectedEmail: string | null; styleTrained: boolean }`.

- [ ] **Step 1: Create `app/onboarding/OnboardingWizard.tsx`**

```tsx
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
  hadGmail: boolean
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

const STEP_LABELS = ["Connect Gmail", "Train your style"]

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
}: {
  initialStep: OnboardingStep
  connectedEmail: string | null
  styleTrained: boolean
}) {
  const [step, setStep] = useState<OnboardingStep>(initialStep)

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
            <h1 className="text-3xl font-bold text-slate-900">Connect your Gmail</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
              FlowDesk organizes your inbox with labels, drafts replies in your voice, and keeps
              watch so nothing slips. It starts by connecting to your Gmail account.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <a
                href="/api/connectors/gmail/connect"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Connect Gmail →
              </a>
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
                  FlowDesk is labeling your recent emails in Gmail
                  {connectedEmail ? ` for ${connectedEmail}` : ""}. This takes a few seconds.
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
                        FlowDesk labeled your recent inbox in Gmail. Open Gmail and you’ll see the
                        labels on your threads — and it keeps organizing new mail automatically
                        from here.
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
                    <h1 className="text-2xl font-semibold text-slate-900">Gmail connected</h1>
                    <p className="mt-2 text-sm text-slate-500">
                      {firstPass.belowAutomationLevel
                        ? "FlowDesk is connected but your automation level is set below applying Gmail labels. Raise it in Settings → Automation to let FlowDesk organize your inbox."
                        : !firstPass.hadGmail
                          ? "Connect a Gmail account to let FlowDesk start organizing your inbox."
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
```

- [ ] **Step 2: Rewrite `app/onboarding/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { resolveOnboardingStep } from "@/lib/onboarding"
import { prisma } from "@/lib/prisma"
import OnboardingWizard from "./OnboardingWizard"

export const dynamic = "force-dynamic"

// New signups land here (login page redirect), and a fresh Gmail connect
// returns here via the OAuth callback (?connected=<email>). Steps derive from
// real state, so returning users resume at the first incomplete step.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { connected?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const [channel, learnedProfile] = await Promise.all([
    prisma.channel.findFirst({
      where: { tenantId: session.user.tenantId, type: "email" },
      select: { id: true },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId: session.user.tenantId },
      select: { id: true },
    }),
  ])

  const step = resolveOnboardingStep({
    gmailConnected: Boolean(channel),
    styleTrained: Boolean(learnedProfile),
    justConnected: Boolean(searchParams.connected),
  })

  // Fully set up and not arriving from a fresh connect — nothing to onboard.
  if (step === "done") redirect("/home")

  return (
    <OnboardingWizard
      initialStep={step}
      connectedEmail={searchParams.connected ?? null}
      styleTrained={Boolean(learnedProfile)}
    />
  )
}
```

- [ ] **Step 3: Delete the absorbed component**

```bash
git rm app/onboarding/OnboardingFirstPass.tsx
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — Expected: no errors (if `lib/outlook-*.ts` or `geist` errors appear, run `npm install && npx prisma generate` first).
Run: `npm run lint` — Expected: no new warnings/errors.
Run: `rg -n "OnboardingFirstPass" app lib tests` — Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add app/onboarding
git commit -m "feat: two-step onboarding wizard (connect Gmail, train style)"
```

---

### Task 3: Route new signups into the wizard

**Files:**
- Modify: `app/login/page.tsx:114-119` (signup branch of `onSignUp` only)

**Interfaces:**
- Consumes: `/onboarding` page from Task 2. `getAuthSuccessPath(result.url)` already passes relative callback URLs through unchanged, so changing `callbackUrl` is sufficient.

- [ ] **Step 1: Change the signup sign-in callback**

In `app/login/page.tsx`, inside `onSignUp` (NOT `onSignIn` — sign-in stays `/home`), change:

```ts
      const result = await signIn("credentials", {
        email: signupEmail,
        password: signupPassword,
        callbackUrl: "/home",
        redirect: false,
      });
```

to:

```ts
      const result = await signIn("credentials", {
        email: signupEmail,
        password: signupPassword,
        // New accounts go through the onboarding wizard; sign-in stays /home.
        callbackUrl: "/onboarding",
        redirect: false,
      });
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `rg -n "callbackUrl" app/login/page.tsx` — Expected: `/home` in `onSignIn`, `/onboarding` in `onSignUp`.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: send new signups to onboarding wizard"
```

---

### Task 4: Docs update and full checks

**Files:**
- Modify: `docs/CURRENT_STATE.md` (the "Onboarding first-pass" bullet, line ~44)

- [ ] **Step 1: Update the onboarding bullet in `docs/CURRENT_STATE.md`**

Replace the bullet starting `- **Onboarding first-pass:**` so it describes the wizard. Keep the existing first-pass mechanics text and prepend/adjust framing:

```markdown
- **Onboarding wizard:** new signups land on `/onboarding` (`app/onboarding/OnboardingWizard.tsx`), a two-step skippable wizard: (1) Connect Gmail → `GET /api/connectors/gmail/connect`; the OAuth callback returns to `/onboarding?connected=<email>`, which runs `runOnboardingFirstPass` (`lib/agent/onboarding-first-pass.ts`) via a session-authed `POST /api/connectors/gmail/first-pass` — it labels a bounded batch (30 days / 40 threads) of the user's **existing** inbox through the shared `reconcileGmailLabelsForChannel` path, then renders "N emails organized" with a per-label breakdown and sample threads (aggregated from the `gmail.labels.queued` audit rows the pass produces). Classification is deterministic, so the backlog pass costs no LLM spend; it is gated on automation level ≥ 2 (the new-tenant default), and a lower level surfaces an honest "raise your level" message. (2) Train your style → `POST /api/personal-profile/train`, with a "what we learned" summary. Steps derive from real state (`Channel` type `email`, `LearnedReplyProfile`) via `resolveOnboardingStep` (`lib/onboarding.ts`); fully-set-up visitors are redirected to `/home`, and every step is skippable.
```

- [ ] **Step 2: Run full pre-PR checks**

Run: `npm test` — Expected: all pass.
Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm run lint` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add docs/CURRENT_STATE.md
git commit -m "docs: describe onboarding wizard in CURRENT_STATE"
```
