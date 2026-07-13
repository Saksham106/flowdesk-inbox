import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import AppShell from "@/app/components/AppShell"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { LEAD_SEQUENCE_STEPS, readSequenceState } from "@/lib/agent/lead-sequence"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"
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

interface LeadsPageProps {
  searchParams: { minScore?: string; maxScore?: string; stage?: string }
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) redirect("/home")

  const minScore = Number.isFinite(parseInt(searchParams.minScore ?? "", 10))
    ? parseInt(searchParams.minScore!, 10)
    : null
  const maxScore = Number.isFinite(parseInt(searchParams.maxScore ?? "", 10))
    ? parseInt(searchParams.maxScore!, 10)
    : null
  const stageFilter = searchParams.stage || null
  const isFiltered = minScore !== null || maxScore !== null || stageFilter !== null

  const allLeads = await prisma.lead.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { score: "desc" },
    include: {
      conversation: {
        include: { contact: true },
      },
    },
    take: 200,
  })

  const displayLeads = isFiltered
    ? allLeads.filter((l) => {
        if (minScore !== null && l.score < minScore) return false
        if (maxScore !== null && l.score > maxScore) return false
        if (stageFilter && l.stage !== stageFilter) return false
        return true
      })
    : allLeads

  const activeLeads = displayLeads.filter((l) => l.stage !== "won" && l.stage !== "lost")
  const closedLeads = displayLeads.filter((l) => l.stage === "won" || l.stage === "lost")

  const funnel = PIPELINE_STAGES.map((stage) => {
    const stageLeads = allLeads.filter((l) => l.stage === stage)
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

  function WoWTable() {
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const thisWeek = allLeads.filter((l) => l.createdAt >= oneWeekAgo)
    const lastWeek = allLeads.filter(
      (l) => l.createdAt >= twoWeeksAgo && l.createdAt < oneWeekAgo
    )

    function avgScore(set: typeof allLeads) {
      const scored = set.filter((l) => l.scoredAt !== null)
      if (scored.length === 0) return null
      return Math.round(scored.reduce((sum, l) => sum + l.score, 0) / scored.length)
    }

    return (
      <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Week-over-week
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
              <th className="px-5 py-2 text-left"></th>
              <th className="px-5 py-2 text-right">New leads</th>
              <th className="px-5 py-2 text-right">Avg score</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-5 py-3 font-medium text-slate-700">This week</td>
              <td className="px-5 py-3 text-right text-slate-900">{thisWeek.length}</td>
              <td className="px-5 py-3 text-right text-slate-900">
                {avgScore(thisWeek) ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3 font-medium text-slate-500">Last week</td>
              <td className="px-5 py-3 text-right text-slate-500">{lastWeek.length}</td>
              <td className="px-5 py-3 text-right text-slate-500">
                {avgScore(lastWeek) ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  function FilterForm() {
    return (
      <form
        method="GET"
        action="/leads"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Min score</label>
          <input
            type="number"
            name="minScore"
            min="0"
            max="100"
            defaultValue={searchParams.minScore ?? ""}
            className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Max score</label>
          <input
            type="number"
            name="maxScore"
            min="0"
            max="100"
            defaultValue={searchParams.maxScore ?? ""}
            className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Stage</label>
          <select
            name="stage"
            defaultValue={searchParams.stage ?? ""}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">All stages</option>
            {["new", "contacted", "qualified", "won", "lost"].map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Filter
        </button>
        {isFiltered && (
          <Link href="/leads" className="text-sm text-slate-500 hover:text-slate-700">
            Clear
          </Link>
        )}
      </form>
    )
  }

  function LeadRow({ lead }: { lead: (typeof allLeads)[number] }) {
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
    items: typeof allLeads
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
    <AppShell tenantId={session.user.tenantId}>
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 font-serif text-2xl font-normal">Leads</h1>
            <p className="text-sm text-slate-500">
              {activeLeads.length} active lead{activeLeads.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {allLeads.length > 0 && (
          <>
            <WoWTable />
            <FunnelHeader />
          </>
        )}
        <FilterForm />
        <Section
          title={isFiltered ? `Filtered results (${activeLeads.length})` : "Active pipeline"}
          items={activeLeads}
          emptyText="No active leads yet. Leads are detected automatically when conversations contain pricing, demo, or booking signals."
        />
        <Section
          title={isFiltered ? `Closed (${closedLeads.length})` : "Closed"}
          items={closedLeads}
          emptyText="No closed leads."
        />
      </main>
    </div>
    </AppShell>
  )
}
