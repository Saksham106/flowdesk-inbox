"use client"
import { useState } from "react"

type ProposedSlot = { start: string; end: string; label: string }
type SchedulingSession = {
  id: string
  status: string
  proposedTimesJson: ProposedSlot[] | null
  confirmedTime: string | null
  calendarEmail: string | null
  eventId: string | null
  lastBookingError: string | null
}

export default function SchedulingPanel({
  conversationId,
  calendarEmails,
  initialSession,
  hasPendingBookingApproval,
}: {
  conversationId: string
  calendarEmails: string[]
  initialSession: SchedulingSession | null
  hasPendingBookingApproval: boolean
}) {
  const [session, setSession] = useState(initialSession)
  const [selectedCalendar, setSelectedCalendar] = useState(calendarEmails[0] ?? "")
  const [loading, setLoading] = useState(false)
  const [confirmingSlot, setConfirmingSlot] = useState<number | null>(null)
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(
    initialSession?.lastBookingError ?? null
  )
  const [approvalPending, setApprovalPending] = useState(hasPendingBookingApproval)

  async function bookEvent() {
    if (booking) return
    setBooking(true)
    setBookingError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/scheduling/book`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) {
        setBookingError(data.error ?? "Booking failed")
        if (data.schedulingSession) setSession(data.schedulingSession)
        return
      }
      setSession(data.schedulingSession)
      setApprovalPending(false)
    } catch {
      setBookingError("Booking failed — try again")
    } finally {
      setBooking(false)
    }
  }

  async function proposeSlots() {
    setLoading(true)
    const res = await fetch(`/api/conversations/${conversationId}/scheduling`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarEmail: selectedCalendar }),
    })
    const data = await res.json()
    setSession(data.schedulingSession)
    setLoading(false)
  }

  async function confirmSlot(slot: ProposedSlot, index: number) {
    if (confirmingSlot !== null) return
    setConfirmingSlot(index)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/scheduling`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedTime: slot.start }),
      })
      const data = await res.json()
      setSession(data.schedulingSession)
    } finally {
      setConfirmingSlot(null)
    }
  }

  if (!session && calendarEmails.length === 0) return null

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-800">Scheduling Request Detected</p>

      {!session || session.status === "detecting" ? (
        <div className="space-y-2">
          {calendarEmails.length > 1 && (
            <select
              value={selectedCalendar}
              onChange={(e) => setSelectedCalendar(e.target.value)}
              className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-xs"
            >
              {calendarEmails.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
          <button
            onClick={proposeSlots}
            disabled={loading || !selectedCalendar}
            className="w-full rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? "Checking availability…" : "Propose time slots"}
          </button>
        </div>
      ) : session.status === "proposing" && session.proposedTimesJson ? (
        <div className="space-y-2">
          <p className="text-xs text-blue-700">Proposed slots &mdash; click to confirm:</p>
          {session.proposedTimesJson.map((slot, i) => (
            <button
              key={i}
              onClick={() => confirmSlot(slot, i)}
              disabled={confirmingSlot !== null}
              className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-left text-xs hover:bg-blue-50 disabled:opacity-50 disabled:cursor-wait"
            >
              {confirmingSlot === i ? "Confirming…" : slot.label}
            </button>
          ))}
        </div>
      ) : session.status === "confirmed" ? (
        <div className="space-y-2">
          <p className="text-xs text-blue-700">
            Time confirmed: {session.confirmedTime ? new Date(session.confirmedTime).toLocaleString() : "—"}
          </p>
          {approvalPending && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
              Booking is waiting for your approval in the{" "}
              <a href="/approvals" className="font-medium underline">approval queue</a>
              {" "}— or book it directly below.
            </p>
          )}
          {bookingError && (
            <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
              Booking failed: {bookingError}
            </p>
          )}
          <button
            onClick={bookEvent}
            disabled={booking}
            className="w-full rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {booking ? "Booking…" : bookingError ? "Retry booking" : "Book calendar event"}
          </button>
        </div>
      ) : session.status === "booked" ? (
        <p className="text-xs text-green-700 font-medium">Calendar event created.</p>
      ) : null}
    </div>
  )
}
