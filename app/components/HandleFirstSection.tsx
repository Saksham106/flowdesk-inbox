"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { CommandCenterConversation, CommandCenterPriority } from "@/lib/agent/command-center"

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  return `${days}d ago`
}

const PRIORITY_STYLES: Partial<Record<CommandCenterPriority, string>> = {
  urgent: "border-l-2 border-l-red-300 bg-red-50/40",
  high: "border-l-2 border-l-amber-300 bg-amber-50/40",
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  otp: "Code detected",
  verification_code: "Code detected",
  password_reset: "Password reset",
  create_password: "Create password",
  email_verification: "Email verification",
  security_alert: "Security alert",
  magic_link: "Login link",
  action_required: "Action required",
}

function actionLabel(type: string): string {
  return ACTION_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function getTonightEightPM(): Date {
  const d = new Date()
  d.setHours(20, 0, 0, 0)
  if (d <= new Date()) d.setDate(d.getDate() + 1)
  return d
}

function getTomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

function getNextMonday(): Date {
  const d = new Date()
  const day = d.getDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

const SNOOZE_PRESETS = [
  { label: "Tonight (8 pm)", getDate: getTonightEightPM },
  { label: "Tomorrow morning", getDate: getTomorrowMorning },
  { label: "Next week", getDate: getNextMonday },
]

interface CardProps {
  item: CommandCenterConversation
}

function HandleFirstCard({ item }: CardProps) {
  const router = useRouter()
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [doneState, setDoneState] = useState<"idle" | "undoable" | "done">("idle")
  const [doneError, setDoneError] = useState<string | null>(null)
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeError, setSnoozeError] = useState<string | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snoozeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!showSnooze) return
    function handleOutsideClick(e: MouseEvent) {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setShowSnooze(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [showSnooze])

  if (doneState === "done") return null

  if (doneState === "undoable") {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between ${PRIORITY_STYLES[item.priority] ?? ""}`}>
        <span className="text-[11px] text-slate-500">Marked as done · </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
            setDoneState("idle")
            fetch(`/api/conversations/${item.id}/workflow-status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workflowStatus: "needs_reply" }),
            })
          }}
          className="text-[10px] font-semibold text-blue-600 hover:underline"
        >
          Undo
        </button>
      </div>
    )
  }

  async function handleDraftReply() {
    setDraftLoading(true)
    setDraftError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/draft/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Draft generation failed")
      }
      router.push(item.href)
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to generate draft")
      setDraftLoading(false)
    }
  }

  async function handleDone(e: React.MouseEvent) {
    e.stopPropagation()
    setDoneError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "done" }),
      })
      if (!res.ok) throw new Error("Failed")
      setDoneState("undoable")
      undoTimerRef.current = setTimeout(() => setDoneState("done"), 5000)
    } catch {
      setDoneError("Couldn't mark as done")
    }
  }

  async function handleWaitingOn(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/conversations/${item.id}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: "waiting_on" }),
      })
      if (!res.ok) throw new Error()
      setDoneState("done")
      router.refresh()
    } catch {
      // silent — secondary action
    }
  }

  async function handleSnooze(e: React.MouseEvent, getDate: () => Date) {
    e.stopPropagation()
    setShowSnooze(false)
    setSnoozeError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozeUntil: getDate().toISOString() }),
      })
      if (!res.ok) throw new Error()
      setDoneState("done")
      router.refresh()
    } catch {
      setSnoozeError("Couldn't snooze")
    }
  }

  function openCard() {
    router.push(item.href)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard()
    }
  }

  const priorityClass = PRIORITY_STYLES[item.priority] ?? ""
  const readClass = item.isRead ? "" : "ring-1 ring-blue-100"
  const action = item.action

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:shadow-sm hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${priorityClass} ${readClass}`}
      aria-label={`Open ${item.displayName}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className={`text-[12px] truncate ${item.isRead ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>
          {item.displayName}
        </p>
        <span className="text-[10px] text-slate-400 flex-shrink-0">{relativeTime(item.lastMessageAt)}</span>
      </div>

      <p className="text-[11px] text-slate-600 truncate mb-1">{item.nextAction}</p>
      <p className="text-[10px] text-slate-400 italic mb-2">{item.reason}</p>

      {action && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {action.hasDetectedCode && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              Code detected
            </span>
          )}
          {!action.hasDetectedCode && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              {actionLabel(action.type)}
            </span>
          )}
          {action.expirationText && (
            <span className="text-[10px] text-red-600 font-medium">⏱ {action.expirationText}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {item.needsReply && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDraftReply() }}
            disabled={draftLoading}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-60 hover:bg-blue-700 transition"
          >
            {draftLoading ? "Generating…" : "Draft Reply"}
          </button>
        )}
        {item.approvalReason && !item.needsReply && (
          <button
            onClick={(e) => { e.stopPropagation(); router.push(item.href) }}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Review Draft
          </button>
        )}
        {action?.actionLink && (
          <a
            href={action.actionLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition"
          >
            Open link →
          </a>
        )}
        {item.needsReply && (
          <button
            onClick={handleWaitingOn}
            className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Waiting On
          </button>
        )}
        <button
          onClick={handleDone}
          className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
        >
          Done
        </button>
        <div ref={snoozeRef} className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSnooze((v) => !v) }}
            className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Snooze
          </button>
          {showSnooze && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-md py-1"
            >
              {SNOOZE_PRESETS.map(({ label, getDate }) => (
                <button
                  key={label}
                  type="button"
                  onClick={(e) => handleSnooze(e, getDate)}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 transition"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {draftError && <span className="text-[10px] text-red-500">{draftError}</span>}
        {doneError && <span className="text-[10px] text-red-500">{doneError}</span>}
        {snoozeError && <span className="text-[10px] text-red-500">{snoozeError}</span>}
      </div>
    </div>
  )
}

interface Props {
  items: CommandCenterConversation[]
}

export default function HandleFirstSection({ items }: Props) {
  const seen = new Set<string>()
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  if (deduped.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center">
        <p className="text-[11px] font-medium text-slate-600">All caught up</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Nothing needs your attention right now.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {deduped.slice(0, 5).map((item) => (
        <HandleFirstCard key={item.id} item={item} />
      ))}
    </div>
  )
}
