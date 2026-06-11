import Link from "next/link"

import type {
  CommandCenterConversation,
  DailyCommandCenter,
} from "@/lib/agent/command-center"

const sections: Array<{
  key: keyof DailyCommandCenter["sections"]
  title: string
  empty: string
}> = [
  { key: "needsReply", title: "Needs your reply", empty: "No replies are waiting on you." },
  { key: "waitingOnThem", title: "Waiting on someone else", empty: "No stale follow-ups today." },
  { key: "meetings", title: "Meetings and scheduling", empty: "No active scheduling holds." },
  { key: "approvals", title: "Needs approval", empty: "No drafts need approval." },
  { key: "opportunities", title: "Opportunities and money", empty: "No lead signals detected today." },
  { key: "potentialProblems", title: "Potential problems", empty: "No sensitive threads detected." },
  { key: "safelyIgnored", title: "Safely ignored", empty: "Nothing has been marked safe to ignore." },
]

export default function DailyBriefSections({
  commandCenter,
}: {
  commandCenter: DailyCommandCenter
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Magic Daily Command Center
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          {commandCenter.headline}
        </h2>
        <p className="mt-1 text-sm font-medium text-emerald-700">
          {commandCenter.droppedBallMessage}
        </p>
      </div>
      <div className="grid gap-4 p-6 md:grid-cols-2">
        {sections.map((section) => (
          <BriefSection
            key={section.key}
            title={section.title}
            empty={section.empty}
            items={commandCenter.sections[section.key]}
          />
        ))}
      </div>
    </section>
  )
}

function BriefSection({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: CommandCenterConversation[]
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
          {items.length}
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 4).map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="block px-4 py-3 hover:bg-white">
                <p className="truncate text-sm font-medium text-slate-900">
                  {item.displayName}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{item.reason}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {item.nextAction}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-slate-500">{empty}</p>
      )}
    </div>
  )
}
