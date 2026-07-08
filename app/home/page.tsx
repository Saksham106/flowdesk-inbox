import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import WarmingUp from "@/app/components/WarmingUp";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesCrmEnabled, accountModeFor } from "@/lib/tenant-capabilities";
import SignOutButton from "@/app/inbox/SignOutButton";
import AutoRefresh from "@/app/components/AutoRefresh";
import AppRail from "@/app/components/AppRail";
import HomeCommandCenter from "@/app/components/HomeCommandCenter";
import GmailSyncControl from "@/app/components/GmailSyncControl";
import { buildDailyCommandCenter, buildBillsSection, CommandCenterInputConversation, PersistedCommandCenterState, CommandCenterState, CommandCenterPriority, type AgentSummary, type BillsSection } from "@/lib/agent/command-center";
import { analyzeRevenueAtRisk } from "@/lib/agent/revenue-at-risk";
import { getAutomationLevel } from "@/lib/agent/automation-level";

export const revalidate = 60;

const HOME_CONVERSATION_LIMIT = 25;
const HOME_MESSAGE_LIMIT = 5;

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

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  try {
    return await renderHomePage(session.user.tenantId);
  } catch (err) {
    if (isDbStartingError(err)) return <WarmingUp />;
    throw err;
  }
}

async function renderHomePage(tenantId: string) {
  const [tenant, statusCounts, gmailChannels] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { salesCrmEnabled: true },
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

  const isBusiness = salesCrmEnabled(tenant);
  const accountType = accountModeFor(tenant);

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

  // pendingApprovals badges the rail, so it's kicked off here to run
  // concurrently with the command-center data fetch below and awaited after.
  const pendingApprovalsPromise = prisma.approvalRequest.count({
    where: { tenantId, status: "pending" },
  });

  // Every query here is independent, so they run in one parallel batch
  // instead of a chain of serialized DB round-trips.
  const [
    commandCenterConversations,
    revenueAtRisk,
    upcomingTasks,
    followUpSetting,
    classifiedLast24h,
    draftedLast24h,
    learnedProfile,
    automationLevel,
    activeRulesCount,
  ] = await Promise.all([
    prisma.conversation.findMany({
      where: { tenantId },
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
    isBusiness ? analyzeRevenueAtRisk(tenantId) : Promise.resolve([]),
    prisma.inboxTask.findMany({
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
    }),
    prisma.followUpSetting.findUnique({
      where: { tenantId },
      select: { staleAfterDays: true },
    }),
    prisma.conversationState.count({
      where: { tenantId, updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.draft.count({
      where: {
        conversation: { tenantId },
        status: "proposed",
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId, updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { id: true },
    }),
    getAutomationLevel(tenantId),
    prisma.agentRule.count({ where: { tenantId, status: "active" } }),
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
    new Date(),
    accountType,
    persistedStatesMap
  );

  const billsSection: BillsSection = buildBillsSection(upcomingTasks, mappedConvs);

  const agentSummary: AgentSummary = {
    classifiedLast24h,
    draftedLast24h,
    learnedRecentlyUpdated: learnedProfile !== null,
  };

  // Resolves immediately — it was issued before the command-center data fetch
  // above and has been in flight the whole time.
  const pendingApprovals = await pendingApprovalsPromise;

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

  return (
    <>
      <AutoRefresh intervalMs={60000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
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
          </div>
        </div>
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">Control room</h1>
              </div>
              <div className="flex items-center gap-2">
                <GmailSyncControl channels={gmailSyncChannels} compact />
                <SignOutButton />
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
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
        </main>
      </div>
    </>
  );
}
