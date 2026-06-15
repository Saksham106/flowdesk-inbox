import type { DailyCommandCenter, AgentSummary, BillsSection } from "@/lib/agent/command-center"
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
  billsSection: BillsSection
}

export default function HomeCommandCenter({
  commandCenter,
  agentSummary,
  date,
  gmailChannels,
  billsSection,
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

          {/* Left 60%: Handle First + Needs Action + Bills & Deadlines */}
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-red-500">
                ⚡ Handle First
              </p>
              <HandleFirstSection items={topActions} />
            </div>
            <NeedsActionSection
              items={sections.needsAction}
              excludeIds={new Set(topActions.map((item) => item.id))}
            />
            {/* Bills & Deadlines */}
            {billsSection.count > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-700">
                  Bills &amp; Deadlines
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {billsSection.count}
                  </span>
                </h3>
                <ul className="mt-3 space-y-2">
                  {billsSection.items.map((item) => (
                    <li key={`${item.conversationId}-${item.title}`}>
                      <a href={item.href} className="flex items-start justify-between gap-2 text-sm hover:underline">
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">{item.displayName}</span>
                          <span className="ml-1.5 text-slate-500">{item.title}</span>
                        </span>
                        {item.dueAt && (
                          <span className="shrink-0 whitespace-nowrap text-xs text-amber-600">
                            Due {item.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
