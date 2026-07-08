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

/** Top-level pillar heading: one per column, sets the accent color for the
 *  whole pillar. Sub-sections inside a pillar use SubHeading (neutral, no
 *  color) so the accent reads as "this whole area is about X" rather than
 *  each sub-section competing for its own attention. */
function PillarHeading({
  icon,
  label,
  count,
  tone,
}: {
  icon: string
  label: string
  count?: number
  tone: "danger" | "accent"
}) {
  const color = tone === "danger" ? "text-red-600" : "text-blue-600"
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

/** Neutral sub-heading for a group within a pillar (e.g. "Handle first"
 *  inside "What needs you"). Deliberately un-colored so it doesn't compete
 *  with the pillar's accent color above it. An optional `href` (e.g. the full
 *  audit log) keeps deeper power-user views one click away without needing a
 *  permanent nav rail icon. */
function SubHeading({ label, badge, href, hrefLabel }: { label: string; badge?: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      {badge && (
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">
          {badge}
        </span>
      )}
      {href && (
        <Link href={href} className="text-[10px] font-medium text-blue-500 hover:underline">
          {hrefLabel ?? "View all →"}
        </Link>
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

        {/* Two pillars: everything that needs a decision from you, and a
            compact summary of what the agent has been doing/learning. */}
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

            <div className="flex flex-col gap-2">
              <SubHeading label="⚡ Handle first" />
              <HandleFirstSection items={topActions} />
            </div>

            <NeedsActionSection
              items={sections.needsAction}
              excludeIds={new Set(topActions.map((item) => item.id))}
            />

            {billsSection.count > 0 && (
              <div className="flex flex-col gap-2">
                <SubHeading label="Bills & Deadlines" badge={String(billsSection.count)} />
                <BillsDeadlinesList items={billsSection.items} />
              </div>
            )}
          </div>

          {/* The agent: what it did, what it learned, who you're waiting on,
              what's saved for later — one pillar instead of three. */}
          <div className="flex flex-col gap-4">
            <PillarHeading icon="✦" label="The agent" tone="accent" />

            <div className="flex flex-col gap-2">
              <SubHeading label="What it did" href="/audit" hrefLabel="Full activity log →" />
              <AgentActivitySection
                agentSummary={agentSummary}
                quietlyHandledBreakdown={quietlyHandledBreakdown}
              />
            </div>

            <div className="flex flex-col gap-2">
              <SubHeading label="What it learned" />
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
            </div>

            <WaitingOnSection
              items={sections.waitingOnThem}
              staleAfterBusinessDays={followUpDelayBusinessDays}
            />
            <ReadLaterSection items={sections.readLater} />
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
