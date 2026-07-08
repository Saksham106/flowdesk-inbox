import type { AiUsageSummary } from "@/lib/ai/usage-summary"

const fmtCost = (n: number) => `$${n.toFixed(4)}`
const fmtLimit = (n: number) => `$${n.toFixed(2)}`

export default function AiUsagePanel({ summary }: { summary: AiUsageSummary }) {
  return (
    <div className="space-y-5">
      {summary.features.length === 0 ? (
        <p className="text-sm text-slate-500">No AI usage recorded this month yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Feature</th>
                <th className="py-2 pr-4 text-right">Today</th>
                <th className="py-2 pr-4 text-right">This month</th>
                <th className="py-2 pr-4 text-right">Calls</th>
                <th className="py-2 text-right">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {summary.features.map((f) => (
                <tr key={f.feature} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4 text-slate-700">{f.label}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-800">{fmtCost(f.dailyCostUsd)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-800">{fmtCost(f.monthlyCostUsd)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-500">{f.monthlyCalls}</td>
                  <td className="py-2 text-right tabular-nums">
                    {f.monthlyBlocked > 0 ? (
                      <span className="text-red-600">{f.monthlyBlocked}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <div className="text-xs text-slate-500">Remaining today</div>
          <div className="mt-0.5 font-medium tabular-nums text-slate-800">
            {fmtCost(summary.dailyRemainingUsd)}{" "}
            <span className="font-normal text-slate-400">of {fmtLimit(summary.dailyLimitUsd)}</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <div className="text-xs text-slate-500">Remaining this month</div>
          <div className="mt-0.5 font-medium tabular-nums text-slate-800">
            {fmtCost(summary.monthlyRemainingUsd)}{" "}
            <span className="font-normal text-slate-400">of {fmtLimit(summary.monthlyLimitUsd)}</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        When a limit is reached, AI requests (inbox chat, rule compilation, classification, drafting) are
        rejected with an error until the budget resets — daily at midnight UTC, monthly on the 1st. Adjust
        limits in the AI Spend Budget panel below.
      </p>
    </div>
  )
}
