import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getCalendarClient, listEvents } from "@/lib/google"
import MeetingCard from "@/app/meetings/MeetingCard"
import type { CalendarEvent } from "@/lib/google"

export const dynamic = "force-dynamic"

export default async function MeetingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const credential = await prisma.googleCalendarCredential.findFirst({
    where: { tenantId },
  })

  if (!credential) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Meeting Prep</h1>
          <p className="mt-3 text-slate-600">
            Connect Google Calendar to get prep briefs and post-meeting follow-ups.
          </p>
          <Link
            href="/settings"
            className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Go to Settings →
          </Link>
        </div>
      </div>
    )
  }

  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  let upcoming: CalendarEvent[] = []
  let recent: CalendarEvent[] = []
  let fetchError = false

  try {
    const calendar = await getCalendarClient(tenantId, credential.email)
    ;[upcoming, recent] = await Promise.all([
      listEvents(calendar, { timeMin: now, maxResults: 10 }),
      listEvents(calendar, { timeMin: yesterday, timeMax: now, maxResults: 10 }),
    ])
  } catch {
    fetchError = true
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
            ← Inbox
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Meeting Prep</h1>
          <p className="mt-1 text-sm text-slate-500">
            Prep briefs from your email history · Post-meeting follow-up drafts
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-8">
        {fetchError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load calendar events. Check your Google Calendar connection in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </div>
        )}

        {!fetchError && upcoming.length === 0 && recent.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-slate-600">No meetings in the next 7 days or past 24 hours.</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Upcoming
            </h2>
            <div className="space-y-4">
              {upcoming.map((event) => (
                <MeetingCard
                  key={event.id}
                  event={event}
                  calendarEmail={credential.email}
                  type="upcoming"
                />
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recent — generate follow-up
            </h2>
            <div className="space-y-4">
              {recent.map((event) => (
                <MeetingCard
                  key={event.id}
                  event={event}
                  calendarEmail={credential.email}
                  type="recent"
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
