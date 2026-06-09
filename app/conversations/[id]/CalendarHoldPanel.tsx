"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

type HoldStatus = "held" | "confirmed" | "cancelled" | "expired"

type CalendarHoldSnapshot = {
  id: string
  calendarEmail: string
  startAt: Date | string
  endAt: Date | string
  expiresAt: Date | string
  status: HoldStatus
}

type ActionState = "idle" | "creating" | "cancelling" | "confirming"

function fmt(date: Date | string) {
  return new Date(date).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export default function CalendarHoldPanel({
  conversationId,
  availableSlots,
  primaryCalendarEmail,
  activeHold,
}: {
  conversationId: string
  availableSlots: string[]
  primaryCalendarEmail: string | null
  activeHold: CalendarHoldSnapshot | null
}) {
  const router = useRouter()
  const [action, setAction] = useState<ActionState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [hold, setHold] = useState<CalendarHoldSnapshot | null>(activeHold)
  const isBusy = action !== "idle"

  async function createHold(slotLabel: string) {
    if (!primaryCalendarEmail || isBusy) return

    // Parse slot label back to a Date — slots come as formatted strings like
    // "Monday, Jun 10 at 9:00 AM". We rely on the ISO strings passed via data-attrs.
    const el = document.querySelector<HTMLButtonElement>(`[data-slot="${slotLabel}"]`)
    const startIso = el?.dataset.start
    const endIso = el?.dataset.end
    if (!startIso || !endIso) return

    setAction("creating")
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/calendar-hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarEmail: primaryCalendarEmail, startAt: startIso, endAt: endIso }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create hold")
      setHold(data.hold)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create hold")
    } finally {
      setAction("idle")
    }
  }

  async function cancelHold() {
    if (!hold || isBusy) return
    setAction("cancelling")
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/calendar-hold/${hold.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Failed to cancel hold")
      }
      setHold(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel hold")
    } finally {
      setAction("idle")
    }
  }

  async function confirmHold() {
    if (!hold || isBusy) return
    setAction("confirming")
    setError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/calendar-hold/${hold.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to confirm hold")
      setHold(data.hold)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm hold")
    } finally {
      setAction("idle")
    }
  }

  const hasSlots = availableSlots.length > 0
  const showSlots = hasSlots && !hold && primaryCalendarEmail

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-600">Scheduling</h2>

      {!primaryCalendarEmail && (
        <p className="text-xs text-slate-400">
          Set a Primary Booking Calendar in Settings to enable scheduling.
        </p>
      )}

      {primaryCalendarEmail && !hasSlots && !hold && (
        <p className="text-xs text-slate-400">
          No available slots yet. Run the AI agent on this conversation to check availability.
        </p>
      )}

      {showSlots && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Available slots — click to hold:</p>
          {availableSlots.map((slot) => (
            <button
              key={slot}
              data-slot={slot}
              data-start={slot}
              data-end={slot}
              onClick={() => createHold(slot)}
              disabled={isBusy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {action === "creating" ? "Creating hold…" : slot}
            </button>
          ))}
        </div>
      )}

      {hold && hold.status === "held" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-800">Tentative hold</p>
            <p className="mt-1 text-xs text-amber-700">{fmt(hold.startAt)} – {fmt(hold.endAt)}</p>
            <p className="mt-0.5 text-xs text-amber-500">
              Expires {fmt(hold.expiresAt)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={cancelHold}
              disabled={isBusy}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {action === "cancelling" ? "Cancelling…" : "Cancel hold"}
            </button>
            <button
              onClick={confirmHold}
              disabled={isBusy}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {action === "confirming" ? "Confirming…" : "Confirm booking"}
            </button>
          </div>
        </div>
      )}

      {hold && hold.status === "confirmed" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-xs font-medium text-green-800">Booking confirmed</p>
          <p className="mt-1 text-xs text-green-700">{fmt(hold.startAt)} – {fmt(hold.endAt)}</p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
