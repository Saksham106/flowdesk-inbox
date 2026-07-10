import Link from "next/link"
import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { stripHtmlToText, buildPreviewText } from "@/lib/email-body"
import GmailSyncControl from "@/app/components/GmailSyncControl"
import { buildConversationHref } from "@/lib/client-navigation"
import ClientFilteredInboxList, { type InboxListItem } from "@/app/components/ClientFilteredInboxList"
import { resolveAccountMode } from "@/lib/account-mode"
import { inboxTag } from "@/lib/cache-tags"
import { deriveWorkflowStatus, type WorkflowStatus } from "@/lib/workflow-status"
import { CONTENT_TYPE_FILTERS, emailTypesForContentFilter } from "@/lib/content-type-filters"
import { buildMailLabelTabWhere, matchesMailLabelTab, type MailLabelTabValue } from "@/lib/mail-label-tabs"

interface Props {
  tenantId: string
  accountType: string | null
  activeConversationId?: string
  status?: string | null
  contentType?: string | null
  q?: string
  sales?: boolean
  labelTab?: MailLabelTabValue | null
  statusCounts?: { status: string; _count: { status: number } }[]
  gmailChannels?: {
    id: string
    emailAddress: string | null
    lastSyncedAt: Date | null
    lastSyncStatus?: string | null
    lastSyncError: string | null
    watchExpiresAt?: Date | string | null
    watchLastRenewalAttempt?: Date | string | null
    watchRenewalError?: string | null
    lastHistoryFallbackAt?: Date | string | null
  }[]
  className?: string
}

export type ConvRow = {
  id: string
  status: string
  lastMessageAt: Date
  externalThreadId: string
  readAt: Date | null
  gmailUnread: boolean | null
  userState: string | null
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

export function mapConversationRowToListItem(
  conv: ConvRow,
  opts: { activeConversationId?: string; isPersonal: boolean; returnTo: string }
): InboxListItem {
  const { activeConversationId, isPersonal, returnTo } = opts
  const attention = attentionCategory(conv)
  const attnCat = attention
  const workflowStatus = deriveWorkflowStatus({
    status: conv.status,
    userState: conv.userState,
    draftStatus: conv.draft?.status,
    attentionCategory: attnCat,
    emailType: conv.stateRecord?.emailType,
  })
  const wfStyle = WORKFLOW_STATUS_STYLE[workflowStatus]
  const name = conv.contact?.name ?? conv.externalThreadId
  const msg0 = conv.messages[0]
  const bodySnippet = msg0?.body ? stripHtmlToText(msg0.body, 75) : ""
  const snippet = buildPreviewText(msg0?.subject, bodySnippet)
  const hasDraft = conv.draft?.status === "proposed" || conv.draft?.status === "approved"
  const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null ?? {}
  const isVip = meta?.isVip === true
  const vipLabel = typeof meta?.vipLabel === "string" ? meta.vipLabel : null
  const snoozeUntil = typeof meta?.snoozeUntil === "string" ? meta.snoozeUntil : null

  return {
    id: conv.id,
    href: buildConversationHref(conv.id, returnTo),
    isSelected: conv.id === activeConversationId,
    isUnread: !conv.readAt && conv.gmailUnread !== false,
    isFyi: workflowStatus === "done",
    isClosed: workflowStatus === "done",
    name,
    subject: msg0?.subject ?? null,
    snippet,
    timeLabel: relativeTime(conv.lastMessageAt),
    statusDot: wfStyle.dot,
    statusText: wfStyle.text,
    statusLabel: WORKFLOW_STATUS_LABEL[workflowStatus],
    hasDraft,
    draftStatus: conv.draft?.status ?? null,
    initialStatus: conv.status,
    attentionCategory: attention,
    contentType: conv.stateRecord?.emailType ?? null,
    isPersonal,
    isGmail: conv.channel.provider === "google",
    isVip,
    vipLabel,
    snoozeUntil,
    searchText: `${name} ${conv.externalThreadId} ${snippet}`.toLowerCase(),
    workflowStatus,
  }
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
  { label: "All",         value: null },
  { label: "Needs Reply", value: "needs_reply" },
  { label: "Waiting",     value: "in_progress" },
  { label: "Done",        value: "closed" },
]


const WORKFLOW_STATUS_STYLE: Record<WorkflowStatus, { dot: string; text: string }> = {
  needs_reply: { dot: "bg-red-500",     text: "text-red-700" },
  draft_ready: { dot: "bg-blue-500",    text: "text-blue-700" },
  waiting_on:  { dot: "bg-indigo-400",  text: "text-indigo-700" },
  read_later:  { dot: "bg-violet-400",  text: "text-violet-700" },
  done:        { dot: "bg-emerald-500", text: "text-emerald-700" },
}

const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  needs_reply: "Needs Reply",
  draft_ready: "Draft Ready",
  waiting_on:  "Waiting On",
  read_later:  "Read Later",
  done:        "Done",
}

async function getCachedStatusCounts(tenantId: string) {
  return unstable_cache(
    () =>
      prisma.conversation.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { status: true },
      }),
    ["app-list-counts", tenantId],
    { revalidate: 60, tags: [inboxTag(tenantId)] }
  )()
}

export function getCachedListData(input: {
  tenantId: string
  status?: string | null
  contentType?: string | null
  q?: string
  sales: boolean
  labelTab?: MailLabelTabValue | null
}) {
  const key = [
    "app-list-column",
    input.tenantId,
    input.status ?? "all",
    input.contentType ?? "all",
    input.labelTab ?? "no-label-tab",
    input.q ?? "",
    input.sales ? "sales" : "standard",
  ]

  const contentEmailTypes = emailTypesForContentFilter(input.contentType)

  return unstable_cache(
    async () => {
      const where: Record<string, unknown> = { tenantId: input.tenantId }
      const andFilters: Record<string, unknown>[] = []
      if (input.status) where.status = input.status
      if (contentEmailTypes) {
        andFilters.push({
          stateRecord: {
            is: {
              emailType: { in: contentEmailTypes },
            },
          },
        })
      }
      if (input.sales) {
        andFilters.push({
          stateRecord: {
            is: {
              isSalesLead: true,
            },
          },
        })
      }
      const labelTabWhere = buildMailLabelTabWhere(input.labelTab)
      if (labelTabWhere) andFilters.push(labelTabWhere)
      if (input.q) {
        // Matches the standalone /search page's message-body search too, so
        // this one box covers both "find a conversation" and "find something
        // someone said" — no separate search page needed.
        andFilters.push({
          OR: [
            { externalThreadId: { contains: input.q, mode: "insensitive" } },
            { contact: { name: { contains: input.q, mode: "insensitive" } } },
            { messages: { some: { body: { contains: input.q, mode: "insensitive" } } } },
          ],
        })
      }
      if (andFilters.length > 0) where.AND = andFilters

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
        // Count non-FYI needs_reply conversations using deterministic stateRecord columns.
        // Omits body/sender regex heuristics from isFyiConversation (AUTOMATED_SENDER_RE etc.),
        // which can't be expressed in SQL. Conversations with stateRecord=null (not yet
        // classified) are counted as needs_reply even if they'd match the regex — badge
        // may be slightly inflated for new inboxes with unprocessed messages.
        prisma.conversation.count({
          where: {
            tenantId: input.tenantId,
            status: "needs_reply",
            NOT: {
              OR: [
                { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
                { stateRecord: { emailType: { in: ["notification", "newsletter", "marketing"] } } },
                { stateRecord: { state: "fyi_only" } },
              ],
            },
          },
        }),
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
  contentType,
  q,
  sales = false,
  labelTab,
  statusCounts,
  gmailChannels = [],
  className = "w-[280px] shrink-0",
}: Props) {
  const isBusiness = accountType === "business"
  const isPersonal = resolveAccountMode(accountType) === "personal"

  const [conversations, needsReplyCount] = await getCachedListData({
    tenantId,
    status: contentType ? null : status,
    contentType,
    q,
    sales: sales && isBusiness,
    labelTab,
  })

  const rawCounts = (statusCounts ?? await getCachedStatusCounts(tenantId)) as { status: string; _count: { status: number } }[]
  const countMap = Object.fromEntries(rawCounts.map((r) => [r.status, r._count.status]))
  countMap.needs_reply = needsReplyCount

  function filterPillHref(s: string | null): string {
    const p = new URLSearchParams()
    if (s) p.set("status", s)
    if (q) p.set("q", q)
    const qs = p.toString()
    return qs ? `/mail?${qs}` : "/mail"
  }

  function contentTypePillHref(t: string | null): string {
    const p = new URLSearchParams()
    if (t) p.set("type", t)
    if (q) p.set("q", q)
    const qs = p.toString()
    return qs ? `/mail?${qs}` : "/mail"
  }

  function currentInboxHref(): string {
    const p = new URLSearchParams()
    if (sales && isBusiness) p.set("sales", "1")
    else if (status) p.set("status", status)
    if (q) p.set("q", q)
    if (labelTab && labelTab !== "all") p.set("label", labelTab)
    const qs = p.toString()
    return qs ? `/mail?${qs}` : "/mail"
  }

  const returnTo = currentInboxHref()
  const scrollKey = [status ?? "all", contentType ?? "all", q ?? "", sales ? "s" : "", labelTab ?? "all"].join("_")
  const emptyMessage = q || status || contentType || sales || (labelTab && labelTab !== "all") ? "No results." : "No conversations yet."
  const displayConversations = conversations.filter((conv) => {
    const ws = deriveWorkflowStatus({
      status: conv.status,
      userState: conv.userState,
      draftStatus: conv.draft?.status,
      attentionCategory: attentionCategory(conv),
      emailType: conv.stateRecord?.emailType,
    })
    if (status === "needs_reply" && ws === "done") return false
    if (
      labelTab &&
      labelTab !== "all" &&
      !matchesMailLabelTab(labelTab, {
        workflowStatus: ws,
        draftStatus: conv.draft?.status,
        attentionCategory: attentionCategory(conv),
        emailType: conv.stateRecord?.emailType ?? null,
      })
    ) {
      return false
    }
    return true
  })

  const listItems: InboxListItem[] = displayConversations.map((conv) =>
    mapConversationRowToListItem(conv, { activeConversationId, isPersonal, returnTo })
  )

  return (
    <ClientFilteredInboxList
      items={listItems}
      defaultQuery={q ?? ""}
      emptyMessage={emptyMessage}
      scrollKey={scrollKey}
      className={className}
      headerEnd={<GmailSyncControl channels={gmailChannels} compact />}
      filters={
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map(({ label, value }) => {
              const isActive = !contentType && (status === value || (value === null && !status))
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
                href={q ? `/mail?sales=1&q=${encodeURIComponent(q)}` : "/mail?sales=1"}
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
          {/* Content-type pills — the same Newsletter/Marketing/Notification/Calendar
              taxonomy applied to Gmail labels (lib/gmail-labels.ts), so the app's
              own categorization doesn't lag behind what shows up in Gmail. */}
          <div className="flex flex-wrap gap-1">
            {CONTENT_TYPE_FILTERS.map(({ label, value }) => {
              const isActive = contentType === value
              return (
                <Link
                  key={value}
                  href={contentTypePillHref(isActive ? null : value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
                    isActive
                      ? "bg-slate-700 text-white"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </div>
        </div>
      }
    />
  )
}
