import Link from "next/link"
import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText, buildPreviewText } from "@/lib/email-body"
import GmailSyncControl from "@/app/components/GmailSyncControl"
import { buildConversationHref } from "@/lib/client-navigation"
import ClientFilteredInboxList, { type InboxListItem } from "@/app/components/ClientFilteredInboxList"
import { resolveAccountMode } from "@/lib/account-mode"
import { inboxTag } from "@/lib/cache-tags"
import { isFyiConversation } from "@/lib/inbox-fyi"

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
    watchExpiresAt?: Date | string | null
    watchLastRenewalAttempt?: Date | string | null
    watchRenewalError?: string | null
    lastHistoryFallbackAt?: Date | string | null
  }[]
  className?: string
}

type ConvRow = {
  id: string
  status: string
  lastMessageAt: Date
  externalThreadId: string
  readAt: Date | null
  gmailUnread: boolean | null
  contact: { name: string; phoneE164: string | null } | null
  messages: { body: string; subject: string | null; direction: string }[]
  draft: { status: string } | null
  stateRecord: {
    state: string
    metadataJson: unknown
    attentionCategory: string | null
    emailType: string | null
  } | null
  channel: { provider: string }
}

function attentionCategory(conv: ConvRow): string | null {
  if (conv.stateRecord?.attentionCategory) return conv.stateRecord.attentionCategory
  const meta = conv.stateRecord?.metadataJson
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null
  const value = (meta as Record<string, unknown>).attentionCategory
  return typeof value === "string" ? value : null
}

function relativeTime(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime()
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

const ATTENTION_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  needs_action: { dot: "bg-blue-500", text: "text-blue-700", label: "Needs Action" },
  review_soon: { dot: "bg-amber-500", text: "text-amber-700", label: "Review Soon" },
  read_later: { dot: "bg-violet-400", text: "text-violet-700", label: "Read Later" },
  fyi_done: { dot: "bg-emerald-500", text: "text-emerald-700", label: "FYI" },
  quiet: { dot: "bg-slate-300", text: "text-slate-500", label: "Quiet" },
}

function getCachedListData(input: {
  tenantId: string
  status?: string | null
  q?: string
  sales: boolean
}) {
  const key = [
    "app-list-column",
    input.tenantId,
    input.status ?? "all",
    input.q ?? "",
    input.sales ? "sales" : "standard",
  ]

  return unstable_cache(
    async () => {
      const where: Record<string, unknown> = { tenantId: input.tenantId }
      if (input.status) where.status = input.status
      if (input.sales) {
        where.stateRecord = {
          is: {
            isSalesLead: true,
          },
        }
      }
      if (input.q) {
        where.OR = [
          { externalThreadId: { contains: input.q, mode: "insensitive" } },
          { contact: { name: { contains: input.q, mode: "insensitive" } } },
        ]
      }

      return Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: { lastMessageAt: "desc" },
          take: 50,
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            contact: true,
            draft: { select: { status: true } },
            stateRecord: { select: { state: true, metadataJson: true, attentionCategory: true, emailType: true } },
            channel: { select: { provider: true } },
          },
        }) as Promise<ConvRow[]>,
        prisma.conversation.groupBy({
          by: ["status"],
          where: { tenantId: input.tenantId },
          _count: { status: true },
        }),
        prisma.conversation.findMany({
          where: { tenantId: input.tenantId, status: "needs_reply" },
          orderBy: { lastMessageAt: "desc" },
          take: 500,
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            contact: true,
            draft: { select: { status: true } },
            stateRecord: { select: { state: true, metadataJson: true, attentionCategory: true, emailType: true } },
            channel: { select: { provider: true } },
          },
        }) as Promise<ConvRow[]>,
      ])
    },
    key,
    { revalidate: 60, tags: [inboxTag(input.tenantId)] }
  )()
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
  const isPersonal = resolveAccountMode(accountType) === "personal"

  const [conversations, counts, needsReplyCandidates] = await getCachedListData({
    tenantId,
    status,
    q,
    sales: sales && isBusiness,
  })

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r._count.status]))
  countMap.needs_reply = needsReplyCandidates.filter((conv) => !isFyiConversation(conv)).length

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
  const scrollKey = [status ?? "all", q ?? "", sales ? "s" : ""].join("_")
  const emptyMessage = q || status || sales ? "No results." : "No conversations yet."
  const displayConversations =
    status === "needs_reply" ? conversations.filter((conv) => !isFyiConversation(conv)) : conversations

  const listItems: InboxListItem[] = displayConversations.map((conv) => {
    const fyi = isFyiConversation(conv)
    const attention = attentionCategory(conv)
    const attentionStyle = attention ? ATTENTION_STYLE[attention] : null
    const displayStatus = fyi ? "closed" : conv.status
    const style = STATUS_STYLE[displayStatus] ?? { dot: "bg-slate-300", text: "text-slate-500" }
    const name = conv.contact?.name ?? conv.externalThreadId
    const msg0 = conv.messages[0]
    const bodySnippet = msg0?.body ? stripHtmlToText(msg0.body, 75) : ""
    const snippet = buildPreviewText(msg0?.subject, bodySnippet)
    const hasDraft = conv.draft?.status === "proposed" || conv.draft?.status === "approved"
    const isClosed = conv.status === "closed"
    const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null ?? {}
    const isVip = meta?.isVip === true
    const vipLabel = typeof meta?.vipLabel === "string" ? meta.vipLabel : null
    const snoozeUntil = typeof meta?.snoozeUntil === "string" ? meta.snoozeUntil : null

    return {
      id: conv.id,
      href: buildConversationHref(conv.id, returnTo),
      isSelected: conv.id === activeConversationId,
      isUnread: !conv.readAt && conv.gmailUnread !== false && !fyi,
      isFyi: fyi,
      isClosed,
      name,
      snippet,
      timeLabel: relativeTime(conv.lastMessageAt),
      statusDot: attentionStyle?.dot ?? style.dot,
      statusText: attentionStyle?.text ?? style.text,
      statusLabel: attentionStyle?.label ?? (fyi ? "No reply needed" : STATUS_LABEL[displayStatus] ?? displayStatus),
      hasDraft,
      initialReadAt: conv.readAt !== null,
      initialStatus: conv.status,
      attentionCategory: attention,
      isPersonal,
      isGmail: conv.channel.provider === "google",
      isVip,
      vipLabel,
      snoozeUntil,
      searchText: `${name} ${conv.externalThreadId} ${snippet}`.toLowerCase(),
    }
  })

  return (
    <ClientFilteredInboxList
      items={listItems}
      defaultQuery={q ?? ""}
      emptyMessage={emptyMessage}
      scrollKey={scrollKey}
      className={className}
      headerEnd={<GmailSyncControl channels={gmailChannels} compact />}
      filters={
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
      }
    />
  )
}
