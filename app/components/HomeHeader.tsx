"use client"

import GmailSyncControl from "@/app/components/GmailSyncControl"

type GmailSyncChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncError: string | null
  watchExpiresAt?: Date | string | null
}

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

interface Props {
  date: Date
  firstName: string | null
  gmailChannels: GmailSyncChannel[]
}

export default function HomeHeader({ date, firstName, gmailChannels }: Props) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <div>
        <p className="text-base font-semibold text-slate-900">
          {greeting(date)}{firstName ? `, ${firstName}` : ""}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{dateLabel(date)}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <GmailSyncControl channels={gmailChannels} compact />
      </div>
    </div>
  )
}
