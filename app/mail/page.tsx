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
import AppSidebar from "@/app/components/AppSidebar";
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel";
import { getCachedListData, mapConversationRowToListItem } from "@/app/components/AppListColumn";
import MailTopTabs from "@/app/components/MailTopTabs";
import MailInboxTable from "@/app/components/MailInboxTable";
import type { InboxListItem } from "@/app/components/ClientFilteredInboxList";
import BulkCloseButton from "@/app/inbox/BulkCloseButton";
import GmailSyncControl from "@/app/components/GmailSyncControl";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";
import { buildConversationHref } from "@/lib/client-navigation";
import { stripHtmlToText } from "@/lib/email-body";
import { isFyiConversation } from "@/lib/inbox-fyi";
import { deriveWorkflowStatus } from "@/lib/workflow-status";
import { CONTENT_TYPE_FILTERS, emailTypesForContentFilter } from "@/lib/content-type-filters";
import { getAppShellContext, isDbStartingError } from "@/lib/app-shell";
import { resolveAccountMode } from "@/lib/account-mode";
import { MAIL_TOP_TABS, matchesMailTopTab, type MailTopTabValue } from "@/lib/mail-top-tabs";

export const revalidate = 60;

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];
const MOBILE_LIST_LIMIT = 50;

interface Props {
  searchParams: { status?: string; q?: string; sales?: string; attention?: string; type?: string; page?: string; tab?: string };
}

function isValidMailTopTab(value: string | undefined): value is MailTopTabValue {
  return MAIL_TOP_TABS.some((t) => t.value === value);
}

export default async function MailPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  try {
    return await renderMailPage(session.user.tenantId, searchParams);
  } catch (err) {
    if (isDbStartingError(err)) return <WarmingUp />;
    throw err;
  }
}

async function renderMailPage(
  tenantId: string,
  searchParams: Props["searchParams"]
) {
  const activeStatus = ALL_STATUSES.includes(searchParams.status as ConversationStatus)
    ? (searchParams.status as ConversationStatus)
    : null;
  const q = searchParams.q?.trim() ?? "";
  const salesFilter = searchParams.sales === "1";
  const attentionFilter = searchParams.attention ?? "";
  const contentTypeFilter = searchParams.type ?? "";
  const contentEmailTypes = emailTypesForContentFilter(contentTypeFilter);
  const mobilePage = Math.max(0, parseInt(searchParams.page ?? "0", 10) || 0);

  const {
    isBusiness,
    accountType,
    countByStatus,
    totalCount,
    needsReplyCount,
    pendingApprovals,
    gmailSyncChannels,
  } = await getAppShellContext(tenantId);

  // Mobile conversation list (the mobile layout renders its own list rather
  // than reusing the desktop AppListColumn).
  const mobileConversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      ...(activeStatus ? { status: activeStatus } : {}),
      ...(salesFilter && isBusiness ? { stateRecord: { is: { isSalesLead: true } } } : {}),
      ...(attentionFilter && attentionFilter !== "life_admin" && attentionFilter !== "snoozed"
        ? { stateRecord: { is: { attentionCategory: attentionFilter } } }
        : {}),
      ...(contentEmailTypes ? { stateRecord: { is: { emailType: { in: contentEmailTypes } } } } : {}),
      ...(q
        ? {
            OR: [
              { externalThreadId: { contains: q, mode: "insensitive" as const } },
              { contact: { name: { contains: q, mode: "insensitive" as const } } },
              { messages: { some: { body: { contains: q, mode: "insensitive" as const } } } },
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
  });
  const hasMoreMobile = mobileConversations.length > MOBILE_LIST_LIMIT;
  const mobileConversationsPage = mobileConversations.slice(0, MOBILE_LIST_LIMIT);

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
    return qs ? `/mail?${qs}` : "/mail";
  }

  function currentMailHref() {
    return tabHref(activeStatus, salesFilter);
  }

  function attentionTabHref(category: string) {
    const params = new URLSearchParams();
    params.set("attention", category);
    if (q) params.set("q", q);
    return `/mail?${params.toString()}`;
  }

  function contentTypeTabHref(value: string) {
    const params = new URLSearchParams();
    params.set("type", value);
    if (q) params.set("q", q);
    return `/mail?${params.toString()}`;
  }

  const listTabs = [
    { label: "All", status: "all" as const, count: totalCount },
    ...ALL_STATUSES.map((s) => ({ label: STATUS_LABELS[s], status: s, count: countByStatus[s] ?? 0 })),
  ];

  const appNavigation = getInboxNavigation({ salesCrm: isBusiness });

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

  // Desktop full-width list data (Task 2.6): reuses the same cached query and
  // row-mapping AppListColumn already uses, so status/type/q/sales filters
  // behave identically to before. `tab` is an additional post-filter layered
  // on top for the desktop top-tabs UI.
  const isPersonal = resolveAccountMode(accountType) === "personal";
  const returnTo = currentMailHref();
  const [desktopConversations] = await getCachedListData({
    tenantId,
    status: contentTypeFilter ? null : activeStatus,
    contentType: contentTypeFilter || undefined,
    q: q || undefined,
    sales: salesFilter && isBusiness,
  });
  const desktopRawItems: InboxListItem[] = desktopConversations.map((conv) =>
    mapConversationRowToListItem(conv, { activeConversationId: undefined, isPersonal, returnTo })
  );
  // Mirrors AppListColumn's needs_reply filter: excludes FYI/done conversations
  // from the needs_reply status view.
  const desktopAllItems =
    activeStatus === "needs_reply"
      ? desktopRawItems.filter((item) => item.workflowStatus !== "done")
      : desktopRawItems;

  const tabCounts: Record<MailTopTabValue, number> = Object.fromEntries(
    MAIL_TOP_TABS.map((t) => [t.value, 0])
  ) as Record<MailTopTabValue, number>;
  for (const item of desktopAllItems) {
    for (const tab of MAIL_TOP_TABS) {
      if (
        matchesMailTopTab(tab.value, {
          workflowStatus: item.workflowStatus,
          emailType: item.contentType ?? null,
          isVip: item.isVip ?? false,
        })
      ) {
        tabCounts[tab.value] += 1;
      }
    }
  }

  const activeTopTab = isValidMailTopTab(searchParams.tab) ? searchParams.tab : null;
  const desktopFilteredItems = activeTopTab
    ? desktopAllItems.filter((item) =>
        matchesMailTopTab(activeTopTab, {
          workflowStatus: item.workflowStatus,
          emailType: item.contentType ?? null,
          isVip: item.isVip ?? false,
        })
      )
    : desktopAllItems;

  const loadMoreHref = (() => {
    const p = new URLSearchParams();
    if (activeStatus) p.set("status", activeStatus);
    if (q) p.set("q", q);
    if (salesFilter) p.set("sales", "1");
    if (attentionFilter) p.set("attention", attentionFilter);
    if (contentTypeFilter) p.set("type", contentTypeFilter);
    p.set("page", String(mobilePage + 1));
    return `/mail?${p.toString()}`;
  })();

  return (
    <>
      <AutoRefresh intervalMs={60000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex lg:h-screen">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h1 className="text-lg font-semibold text-slate-900">Mail</h1>
            <Suspense>
              <SearchInput defaultValue={q} />
            </Suspense>
          </div>
          <MailTopTabs
            activeTab={activeTopTab}
            counts={tabCounts}
            preserveQuery={{ q: q || undefined }}
          />
          <MailInboxTable items={desktopFilteredItems} emptyMessage="No conversations match this view." />
        </div>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">Mail</h1>
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
              {listTabs.map(({ label, status, count }) => {
                const isActive =
                  !salesFilter &&
                  !attentionFilter &&
                  !contentTypeFilter &&
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
                };
                const isActive = attentionFilter === cat && !salesFilter && !activeStatus;
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
                );
              })}
              {CONTENT_TYPE_FILTERS.map(({ label, value }) => {
                const isActive = contentTypeFilter === value;
                return (
                  <Link
                    key={value}
                    href={contentTypeTabHref(value)}
                    className={`whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium transition ${
                      isActive
                        ? "border-blue-600 text-blue-700"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
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
                    href={buildConversationHref(conversation.id, currentMailHref())}
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
          <BulkCloseButton />
        </main>
      </div>

      <AskFlowDeskPanel />
    </>
  );
}
