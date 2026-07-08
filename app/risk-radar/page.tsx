import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"
import {
  buildRiskRadar,
  type RiskRadarItem,
  type RiskRadarPriority,
} from "@/lib/agent/risk-radar"

export const dynamic = "force-dynamic"

const PRIORITY_CLASS: Record<RiskRadarPriority, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-700",
  medium: "bg-slate-100 text-slate-700",
}

const SECTIONS: Array<{
  key: "deadlineSoon" | "finalNotices" | "unanswered" | "sensitive"
  title: string
  empty: string
}> = [
  {
    key: "deadlineSoon",
    title: "Deadlines coming up",
    empty: "No near-term deadline language detected.",
  },
  {
    key: "finalNotices",
    title: "Final notices",
    empty: "No final-notice or interruption language detected.",
  },
  {
    key: "unanswered",
    title: "Unanswered threads",
    empty: "No inbound threads have waited three days or more.",
  },
  {
    key: "sensitive",
    title: "Sensitive content",
    empty: "No sensitive-content signals detected.",
  },
]

export default async function RiskRadarPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.tenantId) {
    redirect("/login")
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) redirect("/home")

  const tenantId = session.user.tenantId
  const conversations = await prisma.conversation.findMany({
    where: { tenantId },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 20 },
      channel: true,
      contact: true,
      draft: true,
    },
  })

  const radar = buildRiskRadar(conversations)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
          <div>
            <p className="text-sm font-medium text-slate-500">Inbox risk radar</p>
            <h1 className="text-2xl font-semibold text-slate-950">Risk Radar</h1>
          </div>
          <Link
            href="/home"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Inbox
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-red-700">
                {radar.totalRiskyConversations} risky thread{radar.totalRiskyConversations === 1 ? "" : "s"}
              </p>
              <h2 className="text-lg font-semibold text-slate-950">
                Things to review before they become expensive
              </h2>
            </div>
            <p className="text-sm text-slate-500">Read-only scan of the latest 200 conversations.</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <SummaryCount label="Deadlines" value={radar.counts.deadlineSoon} />
            <SummaryCount label="Final notices" value={radar.counts.finalNotices} />
            <SummaryCount label="Unanswered" value={radar.counts.unanswered} />
            <SummaryCount label="Sensitive" value={radar.counts.sensitive} />
          </div>
        </section>

        <div className="space-y-5">
          {SECTIONS.map((section) => (
            <section key={section.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  {section.title}
                </h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {radar.counts[section.key]}
                </span>
              </div>

              {radar.sections[section.key].length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-500">{section.empty}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {radar.sections[section.key].map((item) => (
                    <RiskRow key={`${item.signal}:${item.conversationId}`} item={item} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-2xl font-semibold text-slate-950">{value}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

function RiskRow({ item }: { item: RiskRadarItem }) {
  return (
    <li>
      <Link href={item.href} className="block px-4 py-4 transition hover:bg-slate-50">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-slate-950">{item.displayName}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASS[item.priority]}`}>
                {item.priority}
              </span>
              {item.label ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {item.label}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-medium text-slate-700">{item.reason}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.preview}</p>
          </div>
          <div className="shrink-0 text-left text-xs text-slate-500 sm:text-right">
            <p>{ageLabel(item.ageInDays)}</p>
            <p className="mt-1 max-w-56 text-slate-600">{item.nextAction}</p>
          </div>
        </div>
      </Link>
    </li>
  )
}

function ageLabel(days: number): string {
  if (days <= 0) return "Today"
  if (days === 1) return "1 day old"
  return `${days} days old`
}
