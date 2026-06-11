import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { LEAD_SEQUENCE_STEPS, readSequenceState } from "@/lib/agent/lead-sequence"
import { RescoreButton } from "@/app/leads/RescoreButton"

export const dynamic = "force-dynamic"

const STAGE_COLORS: Record<string, string> = {
  new: "bg-slate-100 text-slate-600",
  contacted: "bg-blue-100 text-blue-700",
  qualified: "bg-violet-100 text-violet-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-600",
}

const URGENCY_COLORS: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-slate-500",
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700"
  if (score >= 40) return "bg-amber-100 text-amber-700"
  return "bg-slate-100 text-slate-500"
}

const PIPELINE_STAGES = ["new", "contacted", "qualified"] as const

export default async function LeadsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType === "personal") redirect("/inbox")

  const leads = await prisma.lead.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { score: "desc" },
    include: {
      conversation: {
        include: { contact: true },
      },
    },
    take: 200,
  })

  const activeLeads = leads.filter((l) => l.stage !== "won" && l.stage !== "lost")
  const closedLeads = leads.filter((l) => l.stage === "won" || l.stage === "lost")

  const funnel = PIPELINE_STAGES.map((stage) => {
    const stageLeads = leads.filter((l) => l.stage === stage)
    const totalValue = stageLeads.reduce((sum, l) => sum + (l.estimatedValue ?? 0), 0)
    return { stage, count: stageLeads.length, totalValue }
  })

  function FunnelHeader() {
    return (
      <div className="mb-6 flex flex-wrap gap-3">
        {funnel.map(({ stage, count, totalValue }) => (
          <div
            key={stage}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-600"}`}
            >
              {stage}
            </span>
            <span className="text-sm font-semibold text-slate-900">{count}</span>
            {totalValue > 0 && (
              <span className="text-xs text-slate-500">
                ~${totalValue.toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  function LeadRow({ lead }: { lead: (typeof leads)[number] }) {
    const stageColor = STAGE_COLORS[lead.stage] ?? "bg-slate-100 text-slate-600"
    const urgencyColor = URGENCY_COLORS[lead.urgency] ?? "text-slate-500"
    const sequence = readSequenceState(lead.metadataJson)
    const badgeClass = scoreBadgeClass(lead.score)

    return (
      <li className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {lead.company ?? lead.name}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${stageColor}`}
            >
              {lead.stage}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{lead.need}</p>
          {lead.scoreExplanation ? (
            <p className="mt-0.5 text-xs italic text-slate-500">{lead.scoreExplanation}</p>
          ) : lead.budgetClue ? (
            <p className="mt-0.5 text-xs text-slate-500">{lead.budgetClue}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <p className={`text-xs font-medium capitalize ${urgencyColor}`}>
              {lead.urgency} urgency
            </p>
            {lead.estimatedValue ? (
              <span className="text-xs text-slate-400">
                · ~${lead.estimatedValue.toLocaleString()} est.
              </span>
            ) : null}
          </div>
          {sequence.lastStep > 0 ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Follow-up {sequence.lastStep} of {LEAD_SEQUENCE_STEPS.length} queued
              {sequence.lastStepAt
                ? ` · ${sequence.lastStepAt.toLocaleDateString()}`
                : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
              {lead.score}
            </span>
            <RescoreButton leadId={lead.id} />
          </div>
          <Link
            href={`/conversations/${lead.conversationId}`}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            View →
          </Link>
        </div>
      </li>
    )
  }

  function Section({
    title,
    items,
    emptyText,
  }: {
    title: string
    items: typeof leads
    emptyText: string
  }) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
            {emptyText}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {items.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Leads</h1>
            <p className="text-sm text-slate-500">
              {activeLeads.length} active lead{activeLeads.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {activeLeads.length > 0 && <FunnelHeader />}
        <Section
          title="Active pipeline"
          items={activeLeads}
          emptyText="No active leads yet. Leads are detected automatically when conversations contain pricing, demo, or booking signals."
        />
        <Section
          title="Closed"
          items={closedLeads}
          emptyText="No closed leads."
        />
      </main>
    </div>
  )
}
