import Link from "next/link"
import { Suspense } from "react"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText } from "@/lib/email-body"
import SearchInput from "@/app/inbox/SearchInput"
import GmailSyncControl from "@/app/components/GmailSyncControl"
import { buildConversationHref } from "@/lib/client-navigation"

interface Props {
  tenantId: string
  accountType: string | null
  activeConversationId?: string
  status?: string | null
  q?: string
  sales?: boolean
  gmailChannels?: {
    id: string
    emailAddress: string | null
    lastSyncedAt: Date | null
    lastSyncError: string | null
  }[]
  className?: string
}

type ConvRow = {
  id: string
  status: string
  lastMessageAt: Date
  externalThreadId: string
  contact: { name: string } | null
  messages: { body: string }[]
  draft: { status: string } | null
  stateRecord: { state: string; metadataJson: unknown } | null
}

function isFyi(conv: ConvRow): boolean {
  if (conv.stateRecord?.state === "fyi_only") return true
  const meta = conv.stateRecord?.metadataJson
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const t = (meta as Record<string, unknown>).emailType
    if (t === "notification" || t === "newsletter" || t === "marketing") return true
  }
  return false
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diff / 86400000)
  return `${days}d`
}

const STATUS_FILTERS = [
  { label: "All", value: null },
  { label: "Reply", value: "needs_reply" },
  { label: "Progress", value: "in_progress" },
  { label: "Closed", value: "closed" },
]

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  needs_reply: { dot: "bg-red-500", text: "text-red-700" },
  in_progress: { dot: "bg-amber-400", text: "text-amber-700" },
  closed: { dot: "bg-emerald-500", text: "text-emerald-700" },
}

const STATUS_LABEL: Record<string, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
}

export default async function AppListColumn({
  tenantId,
  accountType,
  activeConversationId,
  status,
  q,
  sales = false,
  gmailChannels = [],
  className = "w-[280px] shrink-0",
}: Props) {
  const isBusiness = accountType === "business"

  const where: Record<string, unknown> = { tenantId }
  if (status) where.status = status
  if (sales && isBusiness) {
    where.stateRecord = {
      is: {
        metadataJson: {
          path: ["isSalesLead"],
          equals: true,
        },
      },
    }
  }
  if (q) {
    where.OR = [
      { externalThreadId: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ]
  }

  const [conversations, counts] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        contact: true,
        draft: { select: { status: true } },
        stateRecord: { select: { state: true, metadataJson: true } },
      },
    }) as Promise<ConvRow[]>,
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    }),
  ])

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r._count.status]))

  function filterPillHref(s: string | null): string {
    const p = new URLSearchParams()
    if (s) p.set("status", s)
    if (q) p.set("q", q)
    const qs = p.toString()
    return qs ? `/inbox?${qs}` : "/inbox"
  }

  function currentInboxHref(): string {
    const p = new URLSearchParams()
    if (sales && isBusiness) p.set("sales", "1")
    else if (status) p.set("status", status)
    if (q) p.set("q", q)
    const qs = p.toString()
    return qs ? `/inbox?${qs}` : "/inbox"
  }

  const returnTo = currentInboxHref()

  return (
    <div className={`flex h-full flex-col border-r border-slate-200 bg-white ${className}`}>
      {/* Header */}
      <div className="border-b border-slate-100 px-3 pb-2 pt-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="pt-1 text-sm font-semibold text-slate-900">Inbox</p>
          <GmailSyncControl channels={gmailChannels} compact />
        </div>
        <Suspense>
          <SearchInput defaultValue={q} />
        </Suspense>
        {/* Filter pills */}
        <div className="mt-2 flex flex-wrap gap-1">
          {STATUS_FILTERS.map(({ label, value }) => {
            const isActive = status === value || (value === null && !status)
            const count = value ? (countMap[value] ?? 0) : undefined
            return (
              <Link
                key={label}
                href={filterPillHref(value)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span className="ml-1 opacity-70">{count}</span>
                )}
              </Link>
            )
          })}
          {isBusiness && (
            <Link
              href={q ? `/inbox?sales=1&q=${encodeURIComponent(q)}` : "/inbox?sales=1"}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                sales
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Sales
            </Link>
          )}
        </div>
      </div>

      {/* Conversation rows */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-xs text-slate-400">
            {q || status || sales ? "No results." : "No conversations yet."}
          </p>
        ) : (
          conversations.map((conv) => {
            const fyi = isFyi(conv)
            const displayStatus = fyi ? "closed" : conv.status
            const style = STATUS_STYLE[displayStatus]
            const name = conv.contact?.name ?? conv.externalThreadId
            const snippet = conv.messages[0]?.body
              ? stripHtmlToText(conv.messages[0].body, 75)
              : ""
            const hasDraft =
              conv.draft?.status === "proposed" || conv.draft?.status === "approved"
            const isSelected = conv.id === activeConversationId

            return (
              <Link
                key={conv.id}
                href={buildConversationHref(conv.id, returnTo)}
                className={`block border-b border-slate-50 px-3 py-2.5 transition ${
                  isSelected
                    ? "border-l-2 border-l-blue-500 bg-blue-50"
                    : "hover:bg-slate-50"
                } ${fyi ? "opacity-50" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <p
                    className={`min-w-0 truncate text-xs ${
                      conv.status === "needs_reply" && !fyi
                        ? "font-bold text-slate-900"
                        : "font-medium text-slate-700"
                    }`}
                  >
                    {name}
                  </p>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {relativeTime(conv.lastMessageAt)}
                  </span>
                </div>
                {snippet && (
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{snippet}</p>
                )}
                <div className="mt-1 flex items-center gap-1.5">
                  {style && (
                    <span className={`flex items-center gap-1 text-[10px] font-semibold ${style.text}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {fyi ? "No reply needed" : STATUS_LABEL[displayStatus]}
                    </span>
                  )}
                  {hasDraft && !fyi && (
                    <span className="text-[10px] font-semibold text-blue-600">✦ draft</span>
                  )}
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
