import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Suspense } from "react";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import SearchInput from "@/app/inbox/SearchInput";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import AppRail from "@/app/components/AppRail";
import AppListColumn from "@/app/components/AppListColumn";
import HomeCommandCenter from "@/app/components/HomeCommandCenter";
import { buildDailyCommandCenter, CommandCenterInputConversation } from "@/lib/agent/command-center";
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";
import { stripHtmlToText } from "@/lib/email-body";

export const dynamic = "force-dynamic";

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];

const AUTOMATED_SENDER_RE = /\b(no-?reply|noreply|notifications?|alerts?|do-not-reply|automated)\b/i
const AUTOMATED_BODY_RE =
  /\b(unsubscribe|you'?re receiving this|this is an automated (email|message|notification)|do not reply to this email)\b/i
const FYI_RE = /\b(fyi|newsletter|for your records|no action|all set|thanks, all set)\b/i

function isFyiConversation(conversation: {
  status: string
  stateRecord: { state: string; metadataJson: unknown } | null
  contact: { phoneE164: string } | null
  messages: { direction: string; body: string }[]
}): boolean {
  if (conversation.stateRecord?.state === "fyi_only") return true
  const meta = conversation.stateRecord?.metadataJson
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const emailType = (meta as Record<string, unknown>).emailType
    if (emailType === "notification" || emailType === "newsletter" || emailType === "marketing") return true
  }
  if (conversation.status !== "needs_reply") return false
  const msg = conversation.messages[0]
  if (!msg || msg.direction !== "inbound") return false
  const email = conversation.contact?.phoneE164 ?? ""
  return AUTOMATED_SENDER_RE.test(email) || AUTOMATED_BODY_RE.test(msg.body) || FYI_RE.test(msg.body)
}

interface Props {
  searchParams: { status?: string; q?: string; sales?: string };
}

export default async function InboxPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  const tenantId = session.user.tenantId;
  const activeStatus = ALL_STATUSES.includes(searchParams.status as ConversationStatus)
    ? (searchParams.status as ConversationStatus)
    : null;
  const q = searchParams.q?.trim() ?? "";
  const salesFilter = searchParams.sales === "1";

  // Home view = no status param and no sales filter (default landing)
  const isHomeView = !searchParams.status && !salesFilter && !q;

  const [tenant, statusCounts] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { accountType: true },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
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
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          channel: true,
          contact: true,
          stateRecord: { select: { metadataJson: true, state: true } },
        },
      })
    : [];

  // Home view data for command center
  const [commandCenterConversations, ignoredStates, pendingFollowUps, revenueAtRisk] =
    isHomeView
      ? await Promise.all([
          prisma.conversation.findMany({
            where: { tenantId },
            orderBy: { lastMessageAt: "desc" },
            take: 75,
            include: {
              messages: { orderBy: { createdAt: "asc" }, take: 20 },
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
              stateRecord: { select: { metadataJson: true } },
            },
          }),
          prisma.conversationState.findMany({
            where: { tenantId },
            include: { conversation: { include: { contact: true } } },
            orderBy: { updatedAt: "desc" },
            take: 200,
          }),
          prisma.agentJob.findMany({
            where: {
              tenantId,
              trigger: { in: ["follow_up", "lead_follow_up"] },
              status: { in: ["pending", "running"] },
            },
            include: { conversation: { include: { contact: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          isBusiness ? analyzeRevenueAtRisk(tenantId) : Promise.resolve([]),
        ])
      : [[], [], [], [] as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>];

  type ConversationForBrief = CommandCenterInputConversation & {
    stateRecord: { metadataJson: unknown } | null;
    leads: { score: number; scoreExplanation: string | null; estimatedValue: number | null }[];
  };

  const commandCenter = isHomeView
    ? buildDailyCommandCenter(
        (commandCenterConversations as ConversationForBrief[]).map((c) => ({
          ...c,
          conversationState: c.stateRecord,
          lead: c.leads[0] ?? null,
        })),
        new Date(),
        accountType
      )
    : null;

  type IgnoredStateRow = {
    metadataJson: unknown;
    conversationId: string;
    conversation: { contact: { name: string } | null; externalThreadId: string };
    reason: string | null;
  };

  type FollowUpJobRow = {
    conversationId: string;
    conversation: { contact: { name: string } | null; externalThreadId: string };
    createdAt: Date;
  };

  const ignoredConversations = (ignoredStates as IgnoredStateRow[])
    .filter((s) => {
      const meta = s.metadataJson as Record<string, unknown> | null;
      return meta?.safelyIgnored === true;
    })
    .map((s) => ({
      id: s.conversationId,
      displayName: s.conversation.contact?.name ?? s.conversation.externalThreadId,
      reason: s.reason,
      href: `/conversations/${s.conversationId}`,
    }));

  const followUpConversations = (pendingFollowUps as FollowUpJobRow[]).map((job) => ({
    id: job.conversationId,
    displayName: job.conversation.contact?.name ?? job.conversation.externalThreadId,
    scheduledAt: job.createdAt,
    href: `/conversations/${job.conversationId}`,
  }));

  const displayConversations = salesFilter
    ? mobileConversations.filter((c) => {
        const meta = c.stateRecord?.metadataJson;
        return (
          meta !== null &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).isSalesLead === true
        );
      })
    : mobileConversations;

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

  return (
    <>
      <AutoRefresh intervalMs={10000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} accountType={accountType} />
        <AppListColumn
          tenantId={tenantId}
          accountType={accountType}
          status={activeStatus}
          q={q || undefined}
          sales={salesFilter}
        />
        {/* Main pane */}
        <main className="flex-1 overflow-hidden bg-slate-50">
          {commandCenter ? (
            <HomeCommandCenter
              commandCenter={commandCenter}
              revenueAtRisk={revenueAtRisk as Awaited<ReturnType<typeof analyzeRevenueAtRisk>>}
              followUps={followUpConversations}
              ignoredItems={ignoredConversations}
              accountType={accountType}
              date={new Date()}
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
          )}
        </main>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div>
                <h1 className="text-xl font-semibold">Inbox</h1>
                <p className="text-sm text-slate-500">
                  {needsReplyCount > 0 ? (
                    <span className="font-medium text-red-600">
                      {needsReplyCount} need{needsReplyCount === 1 ? "s" : ""} reply
                    </span>
                  ) : (
                    "All caught up"
                  )}
                  {" · "}{totalCount} total
                </p>
              </div>
              <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex">
                {appNavigation.primary.map((item) => navLink(item))}
                {secondaryNavMenu()}
                <SignOutButton />
              </div>
              <div className="sm:hidden">
                <SignOutButton />
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
                  followUps={followUpConversations}
                  ignoredItems={ignoredConversations}
                  accountType={accountType}
                  date={new Date()}
                />
              )}
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
                    {q || activeStatus || salesFilter
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
                        href={`/conversations/${conversation.id}`}
                        className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 sm:px-5 sm:py-4"
                      >
                        <div className="flex items-start justify-between gap-2 sm:items-center">
                          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-0">
                            <p className="min-w-0 truncate text-sm font-medium" title={displayName}>
                              {displayName}
                            </p>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              <StatusBadge status={isFyiConversation(conversation) ? "closed" : conversation.status} />
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
            </>
          )}
        </main>
      </div>
    </>
  );
}
