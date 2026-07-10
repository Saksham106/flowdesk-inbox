import {
  describeRuleAuditAction,
  ruleAuditPayloadSummary,
  ruleContextFromAuditPayload,
} from "@/lib/assistant-rule-view"

export type RuleAuditEntry = {
  id: string
  action: string
  createdAt: string
  payloadJson: unknown
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return "Today"
  if (sameDay(date, yesterday)) return "Yesterday"
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" })
}

export default function RuleHistoryList({ entries }: { entries: RuleAuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No rule activity yet. Create or test a rule to see history here.
      </p>
    )
  }

  const groups = new Map<string, RuleAuditEntry[]>()
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt)
    const bucket = groups.get(label)
    if (bucket) bucket.push(entry)
    else groups.set(label, [entry])
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {items.map((entry) => {
              const context = ruleContextFromAuditPayload(entry.payloadJson)
              const summary = ruleAuditPayloadSummary(entry.action, entry.payloadJson)
              return (
                <li key={entry.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">
                      {describeRuleAuditAction(entry.action)}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {(context || summary) && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      {[context, summary].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
