"use client"

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
}

export default function HomeHeader({ date, firstName }: Props) {
  return (
    <div className="mb-3">
      <p className="text-base font-semibold text-slate-900">
        {greeting(date)}{firstName ? `, ${firstName}` : ""}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">{dateLabel(date)}</p>
    </div>
  )
}
