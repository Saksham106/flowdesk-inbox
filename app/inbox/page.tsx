import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Suspense } from "react";
import WarmingUp from "@/app/components/WarmingUp";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import SearchInput from "@/app/inbox/SearchInput";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import AppRail from "@/app/components/AppRail";
import AppListColumn from "@/app/components/AppListColumn";
import DesktopResizablePanels from "@/app/components/DesktopResizablePanels";
import HomeCommandCenter from "@/app/components/HomeCommandCenter"
import BulkCloseButton from "@/app/inbox/BulkCloseButton";
import GmailSyncControl from "@/app/components/GmailSyncControl";
import { buildDailyCommandCenter, buildBillsSection, CommandCenterInputConversation, PersistedCommandCenterState, CommandCenterState, CommandCenterPriority, type AgentSummary, type BillsSection } from "@/lib/agent/command-center";
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";
import { getAutomationLevel, AUTOMATION_LEVEL_DEFAULT } from "@/lib/agent/automation-level";
import { buildConversationHref } from "@/lib/client-navigation";
import { stripHtmlToText } from "@/lib/email-body";
import { isFyiConversation } from "@/lib/inbox-fyi";
import { deriveWorkflowStatus } from "@/lib/workflow-status";

export const revalidate = 60;

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];
const HOME_CONVERSATION_LIMIT = 25
const HOME_MESSAGE_LIMIT = 5
const MOBILE_LIST_LIMIT = 50

interface Props {
  searchParams: { status?: string; q?: string; sales?: string; attention?: string; page?: string };
}

function isDbStartingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("database system is starting up") ||
    msg.includes("database system is not yet accepting connections") ||
    msg.includes("Can't reach database server") ||
    msg.includes("ECONNREFUSED") ||
    (err.constructor.name === "PrismaClientInitializationError" && msg.includes("FATAL"))
  );
}

export default async function InboxPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  try {
    return await renderInboxPage(session.user.tenantId, searchParams);
  } catch (err) {
    if (isDbStartingError(err)) return <WarmingUp />;
    throw err;
  }
}

async function renderInboxPage(
  tenantId: string,
  searchParams: Props["searchParams"]
) {
  const activeStatus = ALL_STATUSES.includes(searchParams.status as ConversationStatus)
    ? (searchParams.status as ConversationStatus)
    : null;
  const q = searchParams.q?.trim() ?? "";
  const salesFilter = searchParams.sales === "1";
  const attentionFilter = searchParams.attention ?? "";
  const mobilePage = Math.max(0, parseInt(searchParams.page ?? "0", 10) || 0)

  // Home view = no status param and no sales filter and no attention filter (default landing)
  const isHomeView = !searchParams.status && !salesFilter && !q && !attentionFilter;

  const [tenant, statusCounts, gmailChannels] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { accountType: true },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    }),
    prisma.channel.findMany({
      where: { tenantId, type: "email", provider: "google" },
      select: {
        id: true,
        emailAddress: true,
        gmailCredential: {
          select: {
            lastSyncedAt: true,
            lastSyncStatus: true,
            lastSyncError: true,
            watchExpiresAt: true,
            watchLastRenewalAttempt: true,
            watchRenewalError: true,
            lastHistoryFallbackAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const isBusiness = tenant?.accountType === "business";
  const accountType = tenant?.accountType ?? "personal";

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;
  const totalCount = statusCounts.reduce((sum, r) => sum + r._count.status, 0);
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

  // Fetch email list for mobile non-home views
  const mobileConversations = !isHomeView
    ? await prisma.conversation.findMany({
        where: {
          tenantId,
          ...(activeStatus ? { status: activeStatus } : {}),
          ...(salesFilter && isBusiness ? { stateRecord: { is: { isSalesLead: true } } } : {}),
          ...(attentionFilter && attentionFilter !== "life_admin" && attentionFilter !== "snoozed"
            ? { stateRecord: { is: { attentionCategory: attentionFilter } } }
            : {}),
          ...(q
            ? {
                OR: [
                  { externalThreadId: { contains: q, mode: "insensitive" as const } },
                  { contact: { name: { contains: q, mode: "insensitive" as const } } },
                ],
              }
            : {}),
        },
        orderBy: { lastMessageAt: "desc" },
        skip: mobilePage * MOBILE_LIST_LIMIT,
        take: MOBILE_LIST_LIMIT + 1,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          channel: true,
          contact: true,
          stateRecord: { select: { metadataJson: true, state: true, attentionCategory: true, emailType: true } },
        },
      })
    : [];
  const hasMoreMobile = mobileConversations.length > MOBILE_LIST_LIMIT
  const mobileConversationsPage = mobileConversations.slice(0, MOBILE_LIST_LIMIT)

  // Home view data for command center
  const [commandCenterConversations, revenueAtRisk] =
    isHomeView
      ? await Promise.all([
          prisma.conversation.findMany({
            where: { tenantId },
            orderBy: { lastMessageAt: "desc" },
            take: HOME_CONVERSATION_LIMIT,
            include: {
              messages: { orderBy: { createdAt: "asc" }, take: HOME_MESSAGE_LIMIT },
              channel: true,
              contact: true,
              draft: true,
              agentJobs: { orderBy: { createdAt: "desc" }, take: 3 },
              approvalRequests: {
                where: { status: "pending" },
                orderBy: { createdAt: "desc" },
                take: 3,
              },
              calendarHolds: {
                where: { status: "held" },
                orderBy: { expiresAt: "asc" },
                take: 3,
              },
              leads: {
                select: { score: true, scoreExplanation: true, estimatedValue: true },
                take: 1,
              },
              stateRecord: {
                select: {
                  state: true,
                  priority: true,
                  reason: true,
                  nextAction: true,
                  confidence: true,
                  source: true,
                  metadataJson: true,
                  attentionCategory: true,
                  emailType: true,
                  isSalesLead: true,
                  isSupport: true,
                  updatedAt: true,
                },
              },
            },
          }),
          isBusiness ? analyzeRevenueAtRisk(tenantId) : Promise.resolve([]),
        ])
      : [[], [] as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>];

  const upcomingTasks = isHomeView
    ? await prisma.inboxTask.findMany({
        where: {
          tenantId,
          status: "open",
          dueAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { dueAt: "asc" },
        take: 10,
        include: {
          conversation: {
            include: { contact: { select: { name: true } } },
          },
        },
      })
    : []

  type ConversationForBrief = CommandCenterInputConversation & {
        stateRecord: ({
          metadataJson: unknown
          state?: string | null
          priority?: string | null
          reason?: string | null
          nextAction?: string | null
          confidence?: number | null
          source?: string | null
          updatedAt?: Date | null
        }) | null;
    leads: { score: number; scoreExplanation: string | null; estimatedValue: number | null }[];
  };

  // Hoist the mapped conversations so both buildDailyCommandCenter and buildBillsSection
  // receive conversationState (not the raw stateRecord field).
  const mappedConvs: CommandCenterInputConversation[] = isHomeView
    ? (commandCenterConversations as ConversationForBrief[]).map((c) => ({
        ...c,
        conversationState: c.stateRecord,
        lead: c.leads[0] ?? null,
      }))
    : []

  // Build a Map of persisted states for quick lookup
  const persistedStatesMap = new Map<string, PersistedCommandCenterState>(
    (commandCenterConversations as ConversationForBrief[])
      .map((conversation) => conversation.stateRecord ? { conversationId: conversation.id, ...conversation.stateRecord } : null)
      .filter((s): s is { conversationId: string; metadataJson: unknown; state?: string | null; priority?: string | null; reason?: string | null; nextAction?: string | null; confidence?: number | null; source?: string | null; updatedAt?: Date | null } => s !== null)
      .map((s) => [
      s.conversationId,
      {
        conversationId: s.conversationId,
        state: s.state as CommandCenterState,
        priority: s.priority as CommandCenterPriority,
        reason: s.reason ?? "",
        nextAction: s.nextAction ?? "",
        confidence: s.confidence ?? 0,
        source: s.source ?? "deterministic",
        metadataJson: s.metadataJson,
        updatedAt: s.updatedAt ?? new Date(0),
      } as PersistedCommandCenterState,
    ])
  );

  const commandCenter = isHomeView
    ? buildDailyCommandCenter(
        mappedConvs,
        new Date(),
        accountType,
        persistedStatesMap
      )
    : null;

  const billsSection: BillsSection = isHomeView
    ? buildBillsSection(upcomingTasks, mappedConvs)
    : { items: [], count: 0 }

  // Tenant follow-up delay (business days) for the Waiting On card's due dates.
  const followUpSetting = isHomeView
    ? await prisma.followUpSetting.findUnique({
        where: { tenantId },
        select: { staleAfterDays: true },
      })
    : null

  const agentSummaryRaw = isHomeView
    ? await Promise.all([
        prisma.conversationState.count({
          where: {
            tenantId,
            updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.draft.count({
          where: {
            conversation: { tenantId },
            status: "proposed",
            updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.learnedReplyProfile.findFirst({
          where: {
            tenantId,
            updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        }),
      ])
    : ([0, 0, null] as const)

  const [classifiedLast24h, draftedLast24h, learnedProfile] = agentSummaryRaw
  const agentSummary: AgentSummary = {
    classifiedLast24h: classifiedLast24h as number,
    draftedLast24h: draftedLast24h as number,
    learnedRecentlyUpdated: learnedProfile !== null,
  }

  // Control-room supervision counts. Pending approvals badges the rail on every
  // view; the automation level and active-rule count drive the home pillars.
  const pendingApprovals = await prisma.approvalRequest.count({
    where: { tenantId, status: "pending" },
  })
  const [automationLevel, activeRulesCount] = isHomeView
    ? await Promise.all([
        getAutomationLevel(tenantId),
        prisma.agentRule.count({ where: { tenantId, status: "active" } }),
      ])
    : ([AUTOMATION_LEVEL_DEFAULT, 0] as const)



  const displayConversations = salesFilter
    ? mobileConversationsPage.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        return (
          meta !== null &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).isSalesLead === true
        );
      })
    : attentionFilter
    ? mobileConversationsPage.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
        const m = meta as Record<string, unknown>;
        if (attentionFilter === "life_admin") return !!m.lifeAdminType;
        if (attentionFilter === "snoozed") return typeof m.snoozeReminderId === "string";
        return m.attentionCategory === attentionFilter;
      })
    : activeStatus === "needs_reply"
    ? mobileConversationsPage.filter((c) => !isFyiConversation(c))
    : mobileConversationsPage;

  function tabHref(status: ConversationStatus | "all" | null, sales = false) {
    const params = new URLSearchParams();
    if (sales) {
      params.set("sales", "1");
    } else if (status) {
      params.set("status", status);
    }
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  function currentInboxHref() {
    return tabHref(activeStatus, salesFilter);
  }

  function attentionTabHref(category: string) {
    const params = new URLSearchParams();
    params.set("attention", category);
    if (q) params.set("q", q);
    return `/inbox?${params.toString()}`;
  }

  const gmailSyncChannels = gmailChannels
    .filter((channel) => channel.gmailCredential)
    .map((channel) => ({
      id: channel.id,
      emailAddress: channel.emailAddress,
      lastSyncedAt: channel.gmailCredential?.lastSyncedAt ?? null,
      lastSyncStatus: channel.gmailCredential?.lastSyncStatus ?? null,
      lastSyncError: channel.gmailCredential?.lastSyncError ?? null,
      watchExpiresAt: channel.gmailCredential?.watchExpiresAt ?? null,
      watchLastRenewalAttempt: channel.gmailCredential?.watchLastRenewalAttempt ?? null,
      watchRenewalError: channel.gmailCredential?.watchRenewalError ?? null,
      lastHistoryFallbackAt: channel.gmailCredential?.lastHistoryFallbackAt ?? null,
    }));

  const listTabs = [
    { label: "All", status: "all" as const, count: totalCount },
    ...ALL_STATUSES.map((s) => ({ label: STATUS_LABELS[s], status: s, count: countByStatus[s] ?? 0 })),
  ];

  const appNavigation = getInboxNavigation(tenant?.accountType);

  function navLink(item: AppNavigationItem, className = "") {
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ${className}`}
      >
        {item.label}
      </Link>
    );
  }

  function secondaryNavMenu(className = "") {
    if (appNavigation.secondary.length === 0) return null;
    return (
      <details className={`relative ${className}`}>
        <summary className="cursor-pointer list-none rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
          More
        </summary>
        <div className="absolute right-0 z-10 mt-2 min-w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {appNavigation.secondary.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    );
  }

  const loadMoreHref = (() => {
    const p = new URLSearchParams()
    if (activeStatus) p.set("status", activeStatus)
    if (q) p.set("q", q)
    if (salesFilter) p.set("sales", "1")
    if (attentionFilter) p.set("attention", attentionFilter)
    p.set("page", String(mobilePage + 1))
    return `/inbox?${p.toString()}`
  })()

  return (
    <>
      <AutoRefresh intervalMs={60000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <DesktopResizablePanels
          storageKey="flowdesk.inbox.desktopPanels"
          left={
            <AppListColumn
              tenantId={tenantId}
              accountType={accountType}
              status={activeStatus}
              q={q || undefined}
              sales={salesFilter}
              statusCounts={statusCounts}
              gmailChannels={gmailSyncChannels}
              className="w-full shrink-0"
            />
          }
          main={
            commandCenter ? (
              <HomeCommandCenter
                commandCenter={commandCenter}
                revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
                accountType={accountType}
                date={new Date()}
                agentSummary={agentSummary}
                gmailChannels={gmailSyncChannels}
                billsSection={billsSection}
                followUpDelayBusinessDays={followUpSetting?.staleAfterDays}
                automationLevel={automationLevel}
                pendingApprovals={pendingApprovals}
                activeRulesCount={activeRulesCount}
                hasGmail={gmailSyncChannels.length > 0}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">Select a conversation</p>
                  <p className="mt-1 text-xs text-slate-400">
                    or{" "}
                    <Link href="/inbox" className="text-blue-600 hover:underline">
                      go to Home
                    </Link>
                  </p>
                </div>
              </div>
            )
          }
        />
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">Control room</h1>
                <p className="text-sm text-slate-500">
                  {needsReplyCount > 0 ? (
                    <span className="font-medium text-red-600">
                      {needsReplyCount} to handle
                    </span>
                  ) : (
                    "All caught up"
                  )}
                  {" · "}{totalCount} total
                </p>
              </div>
              <div className="flex items-center gap-2">
                <GmailSyncControl channels={gmailSyncChannels} compact />
                <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex">
                  {appNavigation.primary.map((item) => navLink(item))}
                  {secondaryNavMenu()}
                  <SignOutButton />
                </div>
                <div className="sm:hidden">
                  <SignOutButton />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 pb-3 sm:hidden">
              {appNavigation.primary.map((item) => navLink(item, "shrink-0"))}
              {secondaryNavMenu("shrink-0")}
            </div>
          </div>

          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              <Link
                href="/inbox"
                className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                  isHomeView
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Home
              </Link>
              {listTabs.map(({ label, status, count }) => {
                const isActive =
                  !isHomeView &&
                  !salesFilter &&
                  !attentionFilter &&
                  (status === "all" ? activeStatus === null && q === "" : activeStatus === status);
                return (
                  <Link
                    key={label}
                    href={tabHref(status)}
                    className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                      isActive
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                          isActive ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
              {isBusiness && (
                <Link
                  href={tabHref(null, true)}
                  className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                    salesFilter
                      ? "border-emerald-600 text-emerald-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Sales
                </Link>
              )}
              {(["needs_reply", "review_soon", "read_later", "life_admin", "snoozed"] as const).map((cat) => {
                const labels: Record<string, string> = {
                  needs_reply: "Reply",
                  review_soon: "Review",
                  read_later: "Later",
                  life_admin: "Life Admin",
                  snoozed: "Snoozed",
                }
                const isActive = attentionFilter === cat && !salesFilter && !activeStatus
                return (
                  <Link
                    key={cat}
                    href={attentionTabHref(cat)}
                    className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                      isActive
                        ? "border-blue-600 text-blue-700"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {labels[cat]}
                  </Link>
                )
              })}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
          {isHomeView ? (
            <>
              {commandCenter && (
                <HomeCommandCenter
                  commandCenter={commandCenter}
                  revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
                  accountType={accountType}
                  date={new Date()}
                  agentSummary={agentSummary}
                  gmailChannels={gmailSyncChannels}
                  billsSection={billsSection}
                  followUpDelayBusinessDays={followUpSetting?.staleAfterDays}
                  automationLevel={automationLevel}
                  pendingApprovals={pendingApprovals}
                  activeRulesCount={activeRulesCount}
                  hasGmail={gmailSyncChannels.length > 0}
                />
              )}
              <BulkCloseButton />
            </>
          ) : (
            <>
              <div className="mb-5">
                <Suspense>
                  <SearchInput defaultValue={q} />
                </Suspense>
              </div>
              <div className="space-y-3">
                {displayConversations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-500">
                    {q || activeStatus || salesFilter || attentionFilter
                      ? "No conversations match your search."
                      : "No conversations yet. Connect Gmail in Settings to import threads."}
                  </div>
                ) : (
                  displayConversations.map((conversation) => {
                    const lastMessage = conversation.messages[0];
                    const displayName = conversation.contact?.name ?? conversation.externalThreadId;
                    const snippet = lastMessage?.body
                      ? stripHtmlToText(lastMessage.body, 100)
                      : "No messages yet";
                    return (
                      <Link
                        key={conversation.id}
                        href={buildConversationHref(conversation.id, currentInboxHref())}
                        className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 sm:px-5 sm:py-4"
                      >
                        <div className="flex items-start justify-between gap-2 sm:items-center">
                          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-0">
                            <p className="min-w-0 truncate text-sm font-medium" title={displayName}>
                              {displayName}
                            </p>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              <StatusBadge status={deriveWorkflowStatus({
                                status: conversation.status,
                                userState: conversation.userState,
                                draftStatus: null,
                                attentionCategory: conversation.stateRecord?.attentionCategory ?? null,
                                emailType: conversation.stateRecord?.emailType ?? null,
                              })} />
                              {isBusiness && conversation.label && <LabelBadge label={conversation.label} />}
                            </div>
                          </div>
                          <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                            {conversation.lastMessageAt.toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">{snippet}</p>
                      </Link>
                    );
                  })
                )}
              </div>
              {hasMoreMobile && (
                <div className="mt-4 text-center">
                  <Link
                    href={loadMoreHref}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Load more
                  </Link>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
