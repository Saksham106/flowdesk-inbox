import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Suspense } from "react";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import SearchInput from "@/app/inbox/SearchInput";
import CommandCenterPanel from "@/app/inbox/CommandCenterPanel";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import { buildDailyCommandCenter } from "@/lib/agent/command-center";
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";

export const dynamic = "force-dynamic";

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];

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

  // Build where clause
  const where = {
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
  };

  const [
    conversations,
    statusCounts,
    commandCenterConversations,
    ignoredStates,
    pendingFollowUps,
    tenant,
    revenueAtRisk,
  ] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        channel: true,
        contact: true,
        stateRecord: { select: { metadataJson: true } },
      },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { externalThreadId: { contains: q, mode: "insensitive" } },
                { contact: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      _count: { status: true },
    }),
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
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { accountType: true },
    }),
    analyzeRevenueAtRisk(tenantId),
  ]);

  const commandCenter = buildDailyCommandCenter(
    commandCenterConversations.map((c) => ({
      ...c,
      conversationState: c.stateRecord,
      lead: c.leads[0] ?? null,
    }))
  );

  const displayConversations = salesFilter
    ? conversations.filter((c) => {
        const meta = c.stateRecord?.metadataJson
        return (
          meta !== null &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).isSalesLead === true
        )
      })
    : conversations;

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;

  const totalCount = statusCounts.reduce((sum, r) => sum + r._count.status, 0);
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

  const ignoredConversations = ignoredStates
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

  const followUpConversations = pendingFollowUps.map((job) => ({
    id: job.conversationId,
    displayName: job.conversation.contact?.name ?? job.conversation.externalThreadId,
    scheduledAt: job.createdAt,
    href: `/conversations/${job.conversationId}`,
  }));

  function tabHref(status: ConversationStatus | null) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  const tabs = [
    { label: "All", status: null, count: totalCount },
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
    <div className="min-h-screen bg-slate-50">
      <AutoRefresh intervalMs={10000} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {/* Title row */}
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
            {/* Desktop nav */}
            <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex">
              {appNavigation.primary.map((item) => navLink(item))}
              {secondaryNavMenu()}
              <SignOutButton />
            </div>
            {/* Mobile: sign out only */}
            <div className="sm:hidden">
              <SignOutButton />
            </div>
          </div>

          {/* Mobile nav strip */}
          <div className="flex flex-wrap items-center gap-1 pb-3 sm:hidden">
            {appNavigation.primary.map((item) => navLink(item, "shrink-0"))}
            {secondaryNavMenu("shrink-0")}
          </div>
        </div>

        {/* Status tabs */}
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <nav className="-mb-px flex gap-6 overflow-x-auto">
            {tabs.map(({ label, status, count }) => {
              const isActive = status === activeStatus;
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
            <Link
              href={q ? `/inbox?sales=1&q=${encodeURIComponent(q)}` : "/inbox?sales=1"}
              className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                salesFilter
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              Sales
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                  salesFilter ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {commandCenter.counts.salesQualified}
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <CommandCenterPanel commandCenter={commandCenter} revenueAtRisk={revenueAtRisk} />

        {/* Follow-up tracker */}
        {followUpConversations.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Follow-ups queued ({followUpConversations.length})
            </p>
            <ul className="space-y-1">
              {followUpConversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={c.href}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-amber-100"
                  >
                    <span className="font-medium text-amber-900">{c.displayName}</span>
                    <span className="text-xs text-amber-600">
                      Queued {c.scheduledAt.toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* What can I ignore */}
        {ignoredConversations.length > 0 && (
          <details className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
              Safely ignored ({ignoredConversations.length})
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {ignoredConversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={c.href}
                    className="flex items-start justify-between gap-4 px-4 py-3 text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-700">{c.displayName}</span>
                    <span className="text-xs text-slate-400">{c.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Search */}
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
              const displayName =
                conversation.contact?.name ?? conversation.externalThreadId;
              return (
                <Link
                  key={conversation.id}
                  href={`/conversations/${conversation.id}`}
                  className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 sm:px-5 sm:py-4"
                >
                  {/* Row 1: sender name + date */}
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className="min-w-0 truncate text-sm font-medium"
                      title={displayName}
                    >
                      {displayName}
                    </p>
                    <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                      {conversation.lastMessageAt.toLocaleString()}
                    </span>
                  </div>
                  {/* Row 2: badges */}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={conversation.status} />
                    {conversation.label && <LabelBadge label={conversation.label} />}
                  </div>
                  {/* Row 3: preview */}
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {lastMessage?.body ?? "No messages yet"}
                  </p>
                </Link>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
