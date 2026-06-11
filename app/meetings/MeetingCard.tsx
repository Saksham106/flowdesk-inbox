"use client"

import { useState } from "react"
import Link from "next/link"
import MeetingBriefView from "@/app/meetings/MeetingBriefView"
import type { CalendarEvent } from "@/lib/google"
import type { MeetingPrepResult } from "@/lib/ai/prompts/meeting-prep"

type Props = {
  event: CalendarEvent
  calendarEmail: string
  type: "upcoming" | "recent"
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export default function MeetingCard({ event, calendarEmail, type }: Props) {
  const [prepLoading, setPrepLoading] = useState(false)
  const [brief, setBrief] = useState<MeetingPrepResult | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)

  const [notes, setNotes] = useState("")
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [inlineFollowUp, setInlineFollowUp] = useState<{ subject: string; body: string } | null>(null)
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGeneratePrep() {
    setPrepLoading(true)
    setPrepError(null)
    try {
      const res = await fetch("/api/meetings/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventTitle: event.summary,
          eventStart: new Date(event.start).toISOString(),
          attendeeEmails: event.attendees,
          calendarEmail,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || "Failed to generate prep brief")
      }
      const data = await res.json() as { brief: MeetingPrepResult }
      setBrief(data.brief)
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setPrepLoading(false)
    }
  }

  async function handleGenerateFollowUp() {
    setFollowUpLoading(true)
    setFollowUpError(null)
    try {
      const res = await fetch("/api/meetings/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTitle: event.summary,
          eventStart: new Date(event.start).toISOString(),
          attendeeEmails: event.attendees,
          calendarEmail,
          userNotes: notes,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error || "Failed to generate follow-up")
      }
      const data = await res.json() as { approvalRequestId?: string; subject?: string; body?: string }
      if (data.approvalRequestId) {
        setApprovalId(data.approvalRequestId)
      } else if (data.subject && data.body) {
        setInlineFollowUp({ subject: data.subject, body: data.body })
      }
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setFollowUpLoading(false)
    }
  }

  function handleCopy() {
    if (!inlineFollowUp) return
    navigator.clipboard.writeText(`Subject: ${inlineFollowUp.subject}\n\n${inlineFollowUp.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{event.summary}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDate(event.start)} · {formatTime(event.start)}–{formatTime(event.end)}
            {event.attendees.length > 0 &&
              ` · ${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {type === "upcoming" && (
        <div className="mt-4">
          {!brief && (
            <button
              onClick={handleGeneratePrep}
              disabled={prepLoading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {prepLoading ? "Generating brief..." : "Generate Prep Brief"}
            </button>
          )}
          {prepError && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
              <span>{prepError}</span>
              <button onClick={handleGeneratePrep} className="underline">
                Retry
              </button>
            </div>
          )}
          {brief && <MeetingBriefView brief={brief} />}
        </div>
      )}

      {type === "recent" && (
        <div className="mt-4 space-y-3">
          {!approvalId && !inlineFollowUp && (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What happened? Any decisions or next steps?"
                className="w-full rounded-lg border border-slate-200 p-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                rows={3}
              />
              <button
                onClick={handleGenerateFollowUp}
                disabled={followUpLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {followUpLoading ? "Generating..." : "Generate Follow-up Draft"}
              </button>
            </>
          )}
          {followUpError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <span>{followUpError}</span>
              <button onClick={handleGenerateFollowUp} className="underline">
                Retry
              </button>
            </div>
          )}
          {approvalId && (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Follow-up draft created.{" "}
              <Link href="/approvals" className="font-medium underline">
                Review in Approvals →
              </Link>
            </div>
          )}
          {inlineFollowUp && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Subject
              </p>
              <p className="mb-3 text-sm text-slate-800">{inlineFollowUp.subject}</p>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Body
              </p>
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{inlineFollowUp.body}</pre>
              <button
                onClick={handleCopy}
                className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
