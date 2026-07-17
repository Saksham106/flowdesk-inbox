import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import AppShell from "@/app/components/AppShell"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  HISTORY_ACTIONS,
  HISTORY_CATEGORY_LABELS,
  describeAuditEvent,
  historyActionsForCategory,
  type HistoryCategory,
  type HistoryEntry,
} from "@/lib/history-feed"

export const dynamic = "force-dynamic"

// How many raw audit rows one render considers. Writeback rows only resolve
// to a category after describeAuditEvent reads their payload, so the page
// over-fetches raw rows and filters in memory rather than paginating in SQL.
const RAW_ROW_WINDOW = 500
const MAX_VISIBLE_ENTRIES = 200

const CATEGORY_ORDER: HistoryCategory[] = [
  "sent",
  "drafted",
  "labeled",
  "swept",
  "organized",
  "meetings",
  "settings",
  "issues",
]

const CATEGORY_DOT: Record<HistoryCategory, string> = {
  sent: "bg-green-500",
  drafted: "bg-blue-400",
  labeled: "bg-violet-400",
  swept: "bg-slate-400",
  organized: "bg-amber-400",
  meetings: "bg-teal-400",
  settings: "bg-slate-300",
  issues: "bg-red-400",
}

type FeedItem = HistoryEntry & {
  id: string
  createdAt: Date
  context: string | null
}

function dayLabel(date: Date, now: Date): string {
  const day = date.toDateString()
  if (day === now.toDateString()) return "Today"
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (day === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function isHistoryCategory(value: string | undefined): value is HistoryCategory {
  return !!value && value in HISTORY_CATEGORY_LABELS
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: { category?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const category = isHistoryCategory(searchParams.category) ? searchParams.category : null
  const actions = category ? historyActionsForCategory(category) : [...HISTORY_ACTIONS]

  const logs = await prisma.auditLog.findMany({
    where: { tenantId, action: { in: actions } },
    orderBy: { createdAt: "desc" },
    take: RAW_ROW_WINDOW,
    select: { id: true, action: true, payloadJson: true, createdAt: true },
  })

  const described = logs
    .map((log) => {
      const entry = describeAuditEvent(log.action, log.payloadJson)
      if (!entry) return null
      if (category && entry.category !== category) return null
      return { ...entry, id: log.id, createdAt: log.createdAt, context: null as string | null }
    })
    .filter((item): item is FeedItem => item !== null)
    .slice(0, MAX_VISIBLE_ENTRIES)

  // One subject/sender line of context per referenced conversation, so
  // "Drafted a reply" reads as "Drafted a reply — Re: Invoice #4821".
  const conversationIds = Array.from(
    new Set(described.map((item) => item.conversationId).filter((id): id is string => !!id))
  )
  const conversations =
    conversationIds.length > 0
      ? await prisma.conversation.findMany({
          where: { id: { in: conversationIds }, tenantId },
          select: {
            id: true,
            contact: { select: { name: true } },
            messages: {
              where: { direction: "inbound" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { subject: true, fromE164: true },
            },
          },
        })
      : []
  const contextById = new Map(
    conversations.map((conversation) => {
      const first = conversation.messages[0]
      const context =
        first?.subject?.trim() || conversation.contact?.name?.trim() || first?.fromE164 || null
      return [conversation.id, context] as const
    })
  )
  for (const item of described) {
    if (item.conversationId) item.context = contextById.get(item.conversationId) ?? null
  }

  const now = new Date()
  const groups: Array<{ label: string; items: FeedItem[] }> = []
  for (const item of described) {
    const label = dayLabel(item.createdAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  return (
    <AppShell tenantId={tenantId}>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-3xl px-6 py-4">
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 font-serif text-2xl font-normal">History</h1>
            <p className="text-sm text-slate-500">
              What FlowDesk has done for you, in plain English.{" "}
              <Link href="/audit" className="text-[var(--color-accent)] hover:underline">
                Technical audit log →
              </Link>
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-8">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/history"
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                !category
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              All
            </Link>
            {CATEGORY_ORDER.map((c) => (
              <Link
                key={c}
                href={`/history?category=${c}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  category === c
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {HISTORY_CATEGORY_LABELS[c]}
              </Link>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className="mt-8 rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              Nothing here yet — as FlowDesk labels, drafts, and tidies your inbox, it shows up
              here.
            </div>
          ) : (
            <div className="mt-6 space-y-8">
              {groups.map((group) => (
                <section key={group.label}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {group.label}
                  </h2>
                  <ol className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-3 px-4 py-3">
                        <span
                          className={`mt-1 inline-block h-2 w-2 shrink-0 self-center rounded-full ${CATEGORY_DOT[item.category]}`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1 text-sm text-slate-700">
                          <p>{item.text}</p>
                          {item.context && (
                            <p className="truncate text-xs text-slate-400">
                              {item.conversationId ? (
                                <Link
                                  href={`/conversations/${item.conversationId}`}
                                  className="hover:text-slate-600 hover:underline"
                                >
                                  {item.context}
                                </Link>
                              ) : (
                                item.context
                              )}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">
                          {item.createdAt.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              {described.length >= MAX_VISIBLE_ENTRIES && (
                <p className="text-center text-xs text-slate-400">
                  Showing the latest {MAX_VISIBLE_ENTRIES} events — the{" "}
                  <Link href="/audit" className="underline hover:text-slate-600">
                    full audit log
                  </Link>{" "}
                  has everything.
                </p>
              )}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  )
}
