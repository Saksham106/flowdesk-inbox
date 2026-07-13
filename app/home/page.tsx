import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import WarmingUp from "@/app/components/WarmingUp";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/app/inbox/SignOutButton";
import AutoRefresh from "@/app/components/AutoRefresh";
import AppRail from "@/app/components/AppRail";
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel";
import HomeCommandCenter from "@/app/components/HomeCommandCenter";
import AccountScopePicker from "@/app/components/AccountScopePicker";
import GmailSyncControl from "@/app/components/GmailSyncControl";
import { buildDailyCommandCenter, buildBillsSection, CommandCenterInputConversation, PersistedCommandCenterState, CommandCenterState, CommandCenterPriority, type AgentSummary, type BillsSection, type CommandCenterConversation } from "@/lib/agent/command-center";
import { AppNavigationItem, getInboxNavigation } from "@/lib/app-navigation";
import { getAppShellContext, isDbStartingError } from "@/lib/app-shell";
import { buildHomeActionFeed, type HomeConversationInput } from "@/lib/home-action-feed";

export const revalidate = 60;

const HOME_CONVERSATION_LIMIT = 25;
const HOME_MESSAGE_LIMIT = 5;
const HOME_APPROVAL_LIMIT = 20;

export default async function HomePage({ searchParams }: { searchParams: { account?: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  try {
    return await renderHomePage(session.user.tenantId, searchParams.account);
  } catch (err) {
    if (isDbStartingError(err)) return <WarmingUp />;
    throw err;
  }
}

async function renderHomePage(tenantId: string, requestedChannelId?: string) {
  const {
    isBusiness,
    accountType,
    needsReplyCount,
    pendingApprovals,
    gmailSyncChannels,
    mailboxAccounts,
    activeChannelId,
  } = await getAppShellContext(tenantId, requestedChannelId);
  const conversationScope = { tenantId, ...(activeChannelId ? { channelId: activeChannelId } : {}) };
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Every query here is independent, so they run in one parallel batch
  // instead of a chain of serialized DB round-trips.
  const [
    commandCenterConversations,
    upcomingTasks,
    followUpSetting,
    classifiedLast24h,
    draftedLast24h,
    learnedProfile,
    receivedToday,
    handledToday,
    pendingApprovalItems,
  ] = await Promise.all([
    prisma.conversation.findMany({
      where: conversationScope,
      orderBy: { lastMessageAt: "desc" },
      take: HOME_CONVERSATION_LIMIT,
      include: {
        // Newest messages first: latestMessage() picks the most recent and
        // the body-text classification fallback wants recent content.
        messages: { orderBy: { createdAt: "desc" }, take: HOME_MESSAGE_LIMIT },
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
    prisma.inboxTask.findMany({
      where: {
        tenantId,
        ...(activeChannelId ? { conversation: { channelId: activeChannelId } } : {}),
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
    }),
    prisma.followUpSetting.findUnique({
      where: { tenantId },
      select: { staleAfterDays: true },
    }),
    prisma.conversationState.count({
      where: { tenantId, updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, ...(activeChannelId ? { conversation: { channelId: activeChannelId } } : {}) },
    }),
    prisma.draft.count({
      where: {
        conversation: conversationScope,
        status: "proposed",
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId, updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { id: true },
    }),
    prisma.message.count({
      where: {
        direction: "inbound",
        createdAt: { gte: startOfToday },
        conversation: conversationScope,
      },
    }),
    prisma.conversationState.count({
      where: {
        tenantId,
        updatedAt: { gte: startOfToday },
        source: { notIn: ["user_override", "gmail_label"] },
        OR: [
          { state: { in: ["done", "read_later", "fyi_only"] } },
          { attentionCategory: { in: ["quiet", "fyi_done"] } },
        ],
        conversation: {
          ...(activeChannelId ? { channelId: activeChannelId } : {}),
          approvalRequests: { none: { status: "pending" } },
        },
      },
    }),
    prisma.approvalRequest.findMany({
      where: { tenantId, status: "pending", ...(activeChannelId ? { conversation: { channelId: activeChannelId } } : {}) },
      orderBy: { createdAt: "asc" },
      take: HOME_APPROVAL_LIMIT,
      include: { conversation: { include: { contact: true } } },
    }),
  ]);

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
  const mappedConvs: CommandCenterInputConversation[] = (commandCenterConversations as ConversationForBrief[]).map((c) => ({
    ...c,
    conversationState: c.stateRecord,
    lead: c.leads[0] ?? null,
  }));

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

  const commandCenter = buildDailyCommandCenter(
    mappedConvs,
    now,
    accountType,
    persistedStatesMap
  );

  const billsSection: BillsSection = buildBillsSection(upcomingTasks, mappedConvs);

  const agentSummary: AgentSummary = {
    classifiedLast24h,
    draftedLast24h,
    learnedRecentlyUpdated: learnedProfile !== null,
  };

  const toHomeConversation = (item: CommandCenterConversation): HomeConversationInput => ({
    id: item.id,
    title: item.nextAction || item.reason || `Review ${item.displayName}`,
    subtitle: `${item.displayName} · ${relativeConversationAge(item.lastMessageAt, now)}`,
    lastMessageAt: item.lastMessageAt,
  });
  const staleDays = followUpSetting?.staleAfterDays ?? 3;
  const staleCutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
  const feed = buildHomeActionFeed({
    approvals: pendingApprovalItems.map((approval) => ({
      id: approval.id,
      conversationId: approval.conversationId,
      title: approval.step === "send" ? "Approve the prepared reply" : `Review ${approval.step}`,
      subtitle: approval.conversation.contact?.name ?? approval.conversation.externalThreadId,
      createdAt: approval.createdAt,
    })),
    topActions: commandCenter.topActions.map(toHomeConversation),
    needsAction: commandCenter.sections.needsAction.map(toHomeConversation),
    deadlines: billsSection.items
      .filter((item): item is typeof item & { taskId: string } => Boolean(item.taskId))
      .map((item) => ({
        taskId: item.taskId,
        conversationId: item.conversationId,
        title: item.title,
        subtitle: `${item.displayName}${item.dueAt ? ` · Due ${item.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`,
        href: item.href,
        dueAt: item.dueAt,
      })),
    followUps: commandCenter.sections.waitingOnThem
      .filter((item) => item.lastMessageAt <= staleCutoff)
      .map(toHomeConversation),
    now,
  });

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

  return (
    <>
      <AutoRefresh intervalMs={60000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <div className="flex-1 overflow-y-auto">
          <div className="flex justify-end border-b border-slate-200 bg-white px-6 py-3">
            <AccountScopePicker accounts={mailboxAccounts} activeAccountId={activeChannelId} />
          </div>
          <HomeCommandCenter
            date={now}
            metrics={{ receivedToday, handledToday }}
            feed={feed}
            agentSummary={agentSummary}
            quietlyHandledBreakdown={commandCenter.quietlyHandledBreakdown}
            gmailChannels={gmailSyncChannels}
          />
        </div>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <h1 className="font-serif text-2xl font-normal">Home</h1>
              </div>
              <div className="flex items-center gap-2">
                <AccountScopePicker accounts={mailboxAccounts} activeAccountId={activeChannelId} />
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
        </header>

        <main>
          <HomeCommandCenter
            date={now}
            metrics={{ receivedToday, handledToday }}
            feed={feed}
            agentSummary={agentSummary}
            quietlyHandledBreakdown={commandCenter.quietlyHandledBreakdown}
            gmailChannels={gmailSyncChannels}
          />
        </main>
      </div>

      <AskFlowDeskPanel />
    </>
  );
}

function relativeConversationAge(date: Date, now: Date) {
  const hours = Math.max(0, Math.round((now.getTime() - date.getTime()) / (60 * 60 * 1000)));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
