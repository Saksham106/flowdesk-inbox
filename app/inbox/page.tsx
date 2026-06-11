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

export const dynamic = "force-dynamic";

type ConversationStatus = "needs_reply" | "in_progress" | "closed";

const STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs Reply",
  in_progress: "In Progress",
  closed: "Closed",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as ConversationStatus[];

interface Props {
  searchParams: { status?: string; q?: string };
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

  const [conversations, statusCounts, commandCenterConversations] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        channel: true,
        contact: true,
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
      },
    }),
  ]);

  const commandCenter = buildDailyCommandCenter(commandCenterConversations);

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;

  const totalCount = statusCounts.reduce((sum, r) => sum + r._count.status, 0);
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

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

  return (
    <div className="min-h-screen bg-slate-50">
      <AutoRefresh intervalMs={10000} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
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
          <div className="flex items-center gap-3">
            <Link
              href="/digest"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Digest
            </Link>
            <Link
              href="/audit"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Audit
            </Link>
            <Link
              href="/settings"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>

        {/* Status tabs */}
        <div className="mx-auto max-w-5xl px-6">
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
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <CommandCenterPanel commandCenter={commandCenter} />

        {/* Search */}
        <div className="mb-5">
          <Suspense>
            <SearchInput defaultValue={q} />
          </Suspense>
        </div>

        <div className="space-y-3">
          {conversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-500">
              {q || activeStatus
                ? "No conversations match your search."
                : "No conversations yet. Connect Gmail in Settings to import threads."}
            </div>
          ) : (
            conversations.map((conversation) => {
              const lastMessage = conversation.messages[0];
              const displayName =
                conversation.contact?.name ?? conversation.externalThreadId;
              return (
                <Link
                  key={conversation.id}
                  href={`/conversations/${conversation.id}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{displayName}</p>
                      <StatusBadge status={conversation.status} />
                      {conversation.label && <LabelBadge label={conversation.label} />}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {lastMessage?.body ?? "No messages yet"}
                    </p>
                  </div>
                  <div className="ml-4 shrink-0 text-xs text-slate-400">
                    {conversation.lastMessageAt.toLocaleString()}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
