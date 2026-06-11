import Link from "next/link"
import type { CalendarEvent } from "@/lib/google"

export default function MeetingsTodaySection({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">
          {events.length} meeting{events.length === 1 ? "" : "s"} today
        </h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {events.map((event) => (
          <li key={event.id}>
            <Link href="/meetings" className="block px-6 py-4 hover:bg-slate-50">
              <p className="font-medium text-slate-900">{event.summary}</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {new Date(event.start).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {event.attendees.length > 0 &&
                  ` · ${event.attendees.length} attendee${event.attendees.length === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-xs font-medium text-indigo-600">View prep brief →</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
