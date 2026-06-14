import type { DailyCommandCenter, AgentSummary } from "@/lib/agent/command-center"
import type { RevenueAtRiskItem } from "@/lib/agent/revenue-at-risk"
import HomeHeader from "@/app/components/HomeHeader"
import HomeStats from "@/app/components/HomeStats"
import HandleFirstSection from "@/app/components/HandleFirstSection"
import NeedsActionSection from "@/app/components/NeedsActionSection"
import ReadLaterSection from "@/app/components/ReadLaterSection"
import WaitingOnSection from "@/app/components/WaitingOnSection"
import AgentActivitySection from "@/app/components/AgentActivitySection"
import QuietlyHandledBanner from "@/app/components/QuietlyHandledBanner"

type GmailSyncChannel = {
  id: string
  emailAddress: string | null
  lastSyncedAt: Date | string | null
  lastSyncError: string | null
}

interface Props {
  commandCenter: DailyCommandCenter
  revenueAtRisk: RevenueAtRiskItem[]
  agentSummary: AgentSummary
  accountType: string | null
  date: Date
  gmailChannels: GmailSyncChannel[]
}

export default function HomeCommandCenter({
  commandCenter,
  agentSummary,
  date,
  gmailChannels,
}: Props) {
  const { counts, topActions, sections, quietlyHandledBreakdown } = commandCenter

  const firstName: string | null = null

  const statPills = [
    { label: "Needs Reply", value: counts.needsReply, accent: "red" as const },
    { label: "Needs Action", value: counts.needsAction, accent: "amber" as const },
    { label: "Waiting On", value: counts.waitingOnThem, accent: "blue" as const },
    { label: "Read Later", value: counts.readLater, accent: "neutral" as const },
    { label: "Quietly Handled", value: counts.safelyIgnored, accent: "dim" as const },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-5 max-w-5xl">

        {/* Header */}
        <HomeHeader date={date} firstName={firstName} gmailChannels={gmailChannels} />

        {/* Stats */}
        <HomeStats pills={statPills} />

        {/* 60/40 body grid */}
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">

          {/* Left 60%: Handle First + Needs Action */}
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-red-500">
                ⚡ Handle First
              </p>
              <HandleFirstSection items={topActions} />
            </div>
            <NeedsActionSection items={sections.needsAction} />
          </div>

          {/* Right 40%: Read Later + Waiting On + Agent Activity */}
          <div className="flex flex-col gap-5">
            <ReadLaterSection items={sections.readLater} />
            <WaitingOnSection items={sections.waitingOnThem} />
            <AgentActivitySection
              agentSummary={agentSummary}
              needsActionCount={counts.needsAction}
            />
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
