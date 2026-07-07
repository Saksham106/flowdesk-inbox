import Link from "next/link"
import type { DailyCommandCenter, AgentSummary, BillsSection } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"
import ControlRoomHeader from "@/app/components/ControlRoomHeader"
import HandleFirstSection from "@/app/components/HandleFirstSection"
import NeedsActionSection from "@/app/components/NeedsActionSection"
import ReadLaterSection from "@/app/components/ReadLaterSection"
import WaitingOnSection from "@/app/components/WaitingOnSection"
import AgentActivitySection from "@/app/components/AgentActivitySection"
import QuietlyHandledBanner from "@/app/components/QuietlyHandledBanner"
import BillsDeadlinesList from "@/app/components/BillsDeadlinesList"

interface Props {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
  agentSummary: AgentSummary
  accountType: string | null
  date: Date
  gmailChannels?: unknown[]
  billsSection: BillsSection
  followUpDelayBusinessDays?: number
  automationLevel: number
  pendingApprovals: number
  activeRulesCount: number
  hasGmail: boolean
}

/** Small pillar heading: an accent label + count that frames the sections under it. */
function PillarHeading({
  icon,
  label,
  count,
  tone,
}: {
  icon: string
  label: string
  count?: number
  tone: "danger" | "accent" | "learn"
}) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "accent" ? "text-blue-600" : "text-purple-600"
  return (
    <div className="flex items-center gap-2">
      <p className={`text-[11px] font-bold uppercase tracking-wide ${color}`}>
        {icon} {label}
      </p>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          {count}
        </span>
      )}
    </div>
  )
}

export default function HomeCommandCenter({
  commandCenter,
  agentSummary,
  date,
  billsSection,
  followUpDelayBusinessDays,
  automationLevel,
  pendingApprovals,
  activeRulesCount,
  hasGmail,
}: Props) {
  const { counts, topActions, sections, quietlyHandledBreakdown } = commandCenter

  const needsYouCount = pendingApprovals + topActions.length + billsSection.count

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-5 max-w-5xl mx-auto">

        {/* Control-room identity + Gmail hand-off */}
        <ControlRoomHeader
          automationLevel={automationLevel}
          pendingReview={pendingApprovals}
          hasGmail={hasGmail}
          date={date}
        />

        {/* Three supervision pillars */}
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">

          {/* What needs you */}
          <div className="flex flex-col gap-4">
            <PillarHeading icon="✋" label="What needs you" count={needsYouCount} tone="danger" />

            {pendingApprovals > 0 && (
              <Link
                href="/approvals"
                className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 transition hover:bg-red-100"
              >
                <div>
                  <p className="text-sm font-semibold text-red-700">
                    {pendingApprovals} {pendingApprovals === 1 ? "item" : "items"} to approve
                  </p>
                  <p className="text-xs text-red-500">Drafts and actions waiting on your decision</p>
                </div>
                <span className="text-xs font-medium text-red-600">Review →</span>
              </Link>
            )}

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                ⚡ Handle first
              </p>
              <HandleFirstSection items={topActions} />
            </div>

            <NeedsActionSection
              items={sections.needsAction}
              excludeIds={new Set(topActions.map((item) => item.id))}
            />

            {billsSection.count > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700">
                  Bills &amp; Deadlines
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {billsSection.count}
                  </span>
                </h3>
                <BillsDeadlinesList items={billsSection.items} />
              </section>
            )}
          </div>

          {/* Right column: What FlowDesk did + What it learned */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <PillarHeading icon="✦" label="What FlowDesk did" tone="accent" />
              <AgentActivitySection
                agentSummary={agentSummary}
                quietlyHandledBreakdown={quietlyHandledBreakdown}
              />
            </div>

            <div className="flex flex-col gap-3">
              <PillarHeading icon="🧠" label="What it learned" tone="learn" />
              <Link
                href="/settings"
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">
                    {activeRulesCount} active {activeRulesCount === 1 ? "rule" : "rules"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {agentSummary.learnedRecentlyUpdated
                      ? "Updated from your recent feedback"
                      : "Learning your reply style"}
                  </p>
                </div>
                <span className="text-[11px] font-medium text-slate-400">Tune →</span>
              </Link>
              <WaitingOnSection
                items={sections.waitingOnThem}
                staleAfterBusinessDays={followUpDelayBusinessDays}
              />
              <ReadLaterSection items={sections.readLater} />
            </div>
          </div>
        </div>

        {/* Full-width bottom: Quietly Handled */}
        <QuietlyHandledBanner
          count={counts.safelyIgnored}
          breakdown={quietlyHandledBreakdown}
        />

      </div>
    </div>
  )
}
