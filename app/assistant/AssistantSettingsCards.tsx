import Link from "next/link"
import type { ReactNode } from "react"

// Names match the Level 0-5 trust ladder in app/settings/AutopilotSettingsForm.tsx
// and lib/agent/automation-level.ts. Drafting into Gmail starts at Level 3.
const AUTOMATION_LEVEL_NAMES: Record<number, string> = {
  0: "Observe only",
  1: "Suggest in dashboard",
  2: "Organize Gmail",
  3: "Draft in Gmail",
  4: "Light autopilot",
  5: "Auto-send (restricted)",
}

type AutopilotSnapshot = {
  automationLevel: number
  confidenceThreshold: number
} | null

type FollowUpSnapshot = {
  enabled: boolean
  staleAfterDays: number
  maxFollowUpsPerConversation: number
} | null

type WritingStyleSnapshot = {
  sampleCount: number
  formalityLevel: string | null
  lastTrainedAt: string | null
} | null

function Card({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

export default function AssistantSettingsCards({
  autopilot,
  followUp,
  writingStyle,
  lastDraftGeneratedAt,
}: {
  autopilot: AutopilotSnapshot
  followUp: FollowUpSnapshot
  writingStyle: WritingStyleSnapshot
  lastDraftGeneratedAt: string | null
}) {
  const automationLevel = autopilot?.automationLevel ?? 3
  // Level 3+ leaves suggested replies in the Gmail drafts folder (see
  // AUTOMATION_LEVELS in AutopilotSettingsForm.tsx) — there is no separate
  // auto-draft toggle in this codebase, so "on/off" here reflects the level.
  const draftsOnAtThisLevel = automationLevel >= 3

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card
        title="Auto draft replies"
        description="Whether FlowDesk leaves suggested replies in your Gmail drafts folder."
      >
        <p className="text-sm text-slate-700">
          {draftsOnAtThisLevel ? "On" : "Off"}
          <span className="text-slate-400">
            {" "}
            — Level {automationLevel} ({AUTOMATION_LEVEL_NAMES[automationLevel] ?? "Custom"})
          </span>
        </p>
        {lastDraftGeneratedAt && (
          <p className="mt-1 text-xs text-slate-400">
            Last draft generated {new Date(lastDraftGeneratedAt).toLocaleDateString()}
          </p>
        )}
        <Link
          href="/settings/automation"
          className="mt-2 inline-block text-xs text-slate-500 underline hover:text-slate-700"
        >
          Change automation level
        </Link>
      </Card>

      <Card
        title="Draft confidence"
        description="Minimum AI confidence required before a draft or auto-send is allowed."
      >
        <p className="text-sm text-slate-700">
          {autopilot ? `${Math.round(autopilot.confidenceThreshold * 100)}%` : "Not set yet — using default"}
        </p>
        <Link
          href="/settings/automation"
          className="mt-2 inline-block text-xs text-slate-500 underline hover:text-slate-700"
        >
          Adjust threshold
        </Link>
      </Card>

      <Card
        title="Follow-up reminders"
        description="Surface conversations that have gone quiet so nothing slips through."
      >
        {followUp?.enabled ? (
          <p className="text-sm text-slate-700">
            On — stale after {followUp.staleAfterDays} day{followUp.staleAfterDays === 1 ? "" : "s"}, up to{" "}
            {followUp.maxFollowUpsPerConversation} reminder
            {followUp.maxFollowUpsPerConversation === 1 ? "" : "s"} per conversation
          </p>
        ) : (
          <p className="text-sm text-slate-500">Off</p>
        )}
        <Link
          href="/settings/automation"
          className="mt-2 inline-block text-xs text-slate-500 underline hover:text-slate-700"
        >
          Manage follow-ups
        </Link>
      </Card>

      <Card
        title="Digest"
        description="A daily or weekly summary email of what needs your attention."
      >
        <p className="text-sm text-slate-400">Not available yet.</p>
      </Card>

      <Card
        title="Writing style"
        description="What FlowDesk learned about your tone and phrasing from your sent mail."
      >
        {writingStyle && writingStyle.sampleCount > 0 ? (
          <>
            <p className="text-sm text-slate-700">
              {writingStyle.sampleCount} email{writingStyle.sampleCount === 1 ? "" : "s"} analyzed
              {writingStyle.formalityLevel ? ` · ${writingStyle.formalityLevel}` : ""}
            </p>
            {writingStyle.lastTrainedAt && (
              <p className="mt-0.5 text-xs text-slate-400">
                Last trained {new Date(writingStyle.lastTrainedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Not trained yet.</p>
        )}
        <Link
          href="/settings/training"
          className="mt-2 inline-block text-xs text-slate-500 underline hover:text-slate-700"
        >
          Train writing style
        </Link>
      </Card>
    </div>
  )
}
