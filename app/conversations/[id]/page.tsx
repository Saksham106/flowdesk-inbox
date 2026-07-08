import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ReplyComposer from "@/app/conversations/[id]/ReplyComposer";
import CalendarHoldPanel from "@/app/conversations/[id]/CalendarHoldPanel";
import ExplainThreadPanel from "@/app/conversations/[id]/ExplainThreadPanel";
import HandleThisPanel from "@/app/conversations/[id]/HandleThisPanel";
import WorkItemsPanel from "@/app/conversations/[id]/WorkItemsPanel";
import ThreadStatusHeader from "@/app/conversations/[id]/ThreadStatusHeader";
import StatusButton from "@/app/conversations/[id]/StatusButton";
import MarkReadButton from "@/app/conversations/[id]/MarkReadButton";
import LabelSelect from "@/app/conversations/[id]/LabelSelect"
import WorkflowStatusSelect from "@/app/conversations/[id]/WorkflowStatusSelect";
import SaveContactForm from "@/app/conversations/[id]/SaveContactForm";
import AutoRefresh from "@/app/components/AutoRefresh"
import PersonMemoryEditShell from "./PersonMemoryEditShell";
import CollapsibleCard from "@/app/components/CollapsibleCard";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import AppRail from "@/app/components/AppRail";
import AppListColumn from "@/app/components/AppListColumn";
import DesktopResizablePanels from "@/app/components/DesktopResizablePanels";
import {
  analyzeConversationForCommandCenter,
  buildRelationshipContext,
} from "@/lib/agent/command-center";
import SupportPanel from "@/app/conversations/[id]/SupportPanel";
import SalesPanel from "@/app/conversations/[id]/SalesPanel";
import { SALES_SUGGESTED_ACTIONS } from "@/lib/agent/sales-classifier";
import EmailBody from "@/app/components/EmailBody";
import { resolveAccountMode } from "@/lib/account-mode";
import { accountModeFor } from "@/lib/tenant-capabilities";
import { getSafeInboxReturnPath } from "@/lib/client-navigation";
import { markGmailThreadRead } from "@/lib/google"
import PhishingWarningBanner from "@/app/conversations/[id]/PhishingWarningBanner";
import UnsubscribeButton from "@/app/conversations/[id]/UnsubscribeButton";
import SnoozeButton from "@/app/conversations/[id]/SnoozeButton";
import SecondBrainPanel from "@/app/conversations/[id]/SecondBrainPanel";
import type { ExtractedFact } from "@/lib/agent/second-brain";
import SchedulingPanel from "@/app/conversations/[id]/SchedulingPanel";
import AutomationRunHistory from "@/app/conversations/[id]/AutomationRunHistory";
import type { ProposedSlot } from "@/lib/agent/scheduling";
import type { AutomationStep } from "@/lib/agent/automation-runner";
import { buildConversationTimeline } from "@/lib/agent/conversation-timeline";
import ConversationTimeline from "@/app/conversations/[id]/ConversationTimeline";

export const revalidate = 60;

const INBOX_STATUSES = ["needs_reply", "in_progress", "closed"] as const;
const CONVERSATION_MESSAGE_LIMIT = 50

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { returnTo?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  const sessionAccountType = (session.user as Record<string, unknown>).accountType as string | null;

  // One parallel batch. schedulingSession/automationRuns/calendarCredentials/
  // timelineAuditLogs key only on params.id + tenantId (not on the fetched
  // conversation object), so they join this batch instead of a second
  // serialized round-trip after it.
  const [
    tenant,
    conversation,
    businessProfile,
    latestAgentJob,
    activeHold,
    pendingApprovals,
    needsReplyCount,
    gmailChannels,
    railPendingApprovals,
    schedulingSession,
    automationRuns,
    calendarCredentials,
    timelineAuditLogs,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.conversation.findFirst({
      where: {
        id: params.id,
        tenantId: session.user.tenantId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: CONVERSATION_MESSAGE_LIMIT,
        },
        channel: true,
        contact: true,
        draft: true,
      },
    }),
    prisma.businessProfile.findUnique({
      where: { tenantId: session.user.tenantId },
      select: { id: true, primaryCalendarEmail: true },
    }),
    prisma.agentJob.findFirst({
      where: { conversationId: params.id, tenantId: session.user.tenantId, status: "completed" },
      orderBy: { completedAt: "desc" },
    }),
    prisma.calendarHold.findFirst({
      where: { conversationId: params.id, tenantId: session.user.tenantId, status: "held" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.approvalRequest.findMany({
      where: { conversationId: params.id, tenantId: session.user.tenantId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.conversation.count({
      where: { tenantId: session.user.tenantId, status: "needs_reply" },
    }),
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, type: "email", provider: "google" },
      select: {
        id: true,
        emailAddress: true,
        gmailCredential: {
          select: {
            lastSyncedAt: true,
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
    prisma.approvalRequest.count({
      where: { tenantId: session.user.tenantId, status: "pending" },
    }),
    prisma.schedulingSession.findFirst({ where: { conversationId: params.id, tenantId: session.user.tenantId } }),
    prisma.automationRun.findMany({
      where: { conversationId: params.id, tenantId: session.user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.googleCalendarCredential.findMany({
      where: { tenantId: session.user.tenantId },
      select: { email: true },
    }),
    // Audit rows scoped to this thread via the conversationId embedded in each
    // payload; feeds the "What FlowDesk did" timeline (see conversation-timeline.ts).
    prisma.auditLog.findMany({
      where: {
        tenantId: session.user.tenantId,
        payloadJson: { path: ["conversationId"], equals: params.id },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { user: { select: { email: true } } },
    }),
  ]);

  if (!conversation) {
    notFound();
  }

  const timelineEntries = buildConversationTimeline(
    timelineAuditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      payloadJson: log.payloadJson,
      userEmail: log.user?.email ?? null,
    }))
  ).map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }));

  const openedAt = new Date()
  await Promise.all([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        readAt: openedAt,
        lastOpenedAt: openedAt,
        gmailUnread: false,
      },
    }),
    prisma.message.updateMany({
      // Only touch rows that are actually unread — without this guard every
      // thread open rewrites every message row (up to CONVERSATION_MESSAGE_LIMIT)
      // even when nothing changed.
      where: { conversationId: conversation.id, isRead: false },
      data: { isRead: true },
    }),
  ])

  if (conversation.channel.provider === "google") {
    markGmailThreadRead(
      conversation.channelId,
      conversation.messages.map((message) => message.providerMessageId),
      { tenantId: session.user.tenantId, conversationId: conversation.id }
    ).catch((err) => {
      console.warn("Failed to mark Gmail thread read on open", {
        conversationId: conversation.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
    })
  }

  const accountType = tenant ? accountModeFor(tenant) : (sessionAccountType ?? "personal");
  const accountMode = resolveAccountMode(accountType);
  const isPersonal = accountMode === "personal";
  const inboxReturnPath = getSafeInboxReturnPath(searchParams.returnTo);
  const inboxReturnParams = new URLSearchParams(inboxReturnPath.split("?")[1] ?? "");
  const returnStatusParam = inboxReturnParams.get("status");
  const returnStatus = INBOX_STATUSES.includes(returnStatusParam as (typeof INBOX_STATUSES)[number])
    ? returnStatusParam
    : null;
  const returnSales = inboxReturnParams.get("sales") === "1";
  const returnQuery = inboxReturnParams.get("q") ?? undefined;
  const gmailSyncChannels = gmailChannels
    .filter((channel) => channel.gmailCredential)
    .map((channel) => ({
      id: channel.id,
      emailAddress: channel.emailAddress,
      lastSyncedAt: channel.gmailCredential?.lastSyncedAt ?? null,
      lastSyncError: channel.gmailCredential?.lastSyncError ?? null,
      watchExpiresAt: channel.gmailCredential?.watchExpiresAt ?? null,
      watchLastRenewalAttempt: channel.gmailCredential?.watchLastRenewalAttempt ?? null,
      watchRenewalError: channel.gmailCredential?.watchRenewalError ?? null,
      lastHistoryFallbackAt: channel.gmailCredential?.lastHistoryFallbackAt ?? null,
    }));

  const [stateRecord, inboxTasks, lead, personMemory, rawConciergeTemplates] = await Promise.all([
    prisma.conversationState.findUnique({
      where: { conversationId: conversation.id },
      select: {
        state: true,
        priority: true,
        reason: true,
        nextAction: true,
        confidence: true,
        metadataJson: true,
      },
    }),
    prisma.inboxTask.findMany({
      where: { tenantId: session.user.tenantId, conversationId: conversation.id, status: "open" },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, title: true, status: true, dueAt: true },
    }),
    prisma.lead.findUnique({
      where: {
        tenantId_conversationId: {
          tenantId: session.user.tenantId,
          conversationId: conversation.id,
        },
      },
      select: {
        id: true,
        name: true,
        company: true,
        need: true,
        urgency: true,
        budgetClue: true,
        nextAction: true,
        score: true,
        stage: true,
      },
    }),
    conversation.contactId
      ? prisma.personMemory.findUnique({
          where: { contactId: conversation.contactId },
          select: {
            summary: true,
            preferences: true,
            openQuestions: true,
            promisedActions: true,
            lastContactAt: true,
            messageCount: true,
            factsJson: true,
          },
        })
      : null,
    !isPersonal
      ? prisma.knowledgeDocument.findMany({
          where: { tenantId: session.user.tenantId, sourceType: "concierge_template" },
          select: { id: true, title: true, content: true },
          orderBy: { createdAt: "asc" },
        })
      : null,
  ]);

  const conciergeTemplates = (rawConciergeTemplates ?? []).map(
    (d: { id: string; title: string; content: string }) => ({
      id: d.id,
      title: d.title.replace("[Template] ", ""),
      content: d.content,
    })
  )

  const convMeta =
    stateRecord?.metadataJson &&
    typeof stateRecord.metadataJson === "object" &&
    !Array.isArray(stateRecord.metadataJson)
      ? (stateRecord.metadataJson as Record<string, unknown>)
      : {}

  const secondBrainFacts: ExtractedFact[] = Array.isArray(personMemory?.factsJson)
    ? (personMemory.factsJson as ExtractedFact[])
    : []

  const isSupport = convMeta.isSupport === true
  const churnRisk = convMeta.churnRisk === true
  const needsEscalation = convMeta.needsEscalation === true
  const suggestedKbDocId =
    typeof convMeta.suggestedKbDocId === "string" ? convMeta.suggestedKbDocId : null

  const isVip = convMeta.isVip === true
  const vipLabel = typeof convMeta.vipLabel === "string" ? convMeta.vipLabel : null

  const phishingVerdict = typeof convMeta.phishingVerdict === "string" ? convMeta.phishingVerdict : null
  const phishingMarkedSafe = convMeta.phishingMarkedSafe === true

  const hasUnsubscribeLink = convMeta.hasUnsubscribeLink === true
  const resurfacedFromSnooze = convMeta.resurfacedFromSnooze === true

  const isSalesLead = convMeta.isSalesLead === true
  const closingStage =
    typeof convMeta.closingStage === "string" ? convMeta.closingStage : "prospect"
  const extractedBudget =
    typeof convMeta.extractedBudget === "string" ? convMeta.extractedBudget : null
  const extractedTimeline =
    typeof convMeta.extractedTimeline === "string" ? convMeta.extractedTimeline : null
  const salesSuggestedAction = isSalesLead
    ? (SALES_SUGGESTED_ACTIONS[closingStage as keyof typeof SALES_SUGGESTED_ACTIONS] ?? "")
    : ""

  const suggestedKbDoc = suggestedKbDocId
    ? await prisma.knowledgeDocument.findFirst({
        where: { id: suggestedKbDocId, tenantId: session.user.tenantId },
        select: { id: true, title: true, content: true, sourceType: true },
      })
    : null

  const canSuggestReply =
    conversation.channel.type === "email" && (isPersonal || Boolean(businessProfile));

  const displayName = conversation.contact?.name ?? conversation.externalThreadId;
  const attentionCategory =
    typeof convMeta.attentionCategory === "string" ? convMeta.attentionCategory : null
  const attentionReason =
    typeof convMeta.attentionReason === "string" ? convMeta.attentionReason : null
  const emailType =
    typeof convMeta.emailType === "string" ? convMeta.emailType : null
  const isAutoEmailConversation =
    attentionCategory === "quiet" ||
    attentionCategory === "fyi_done" ||
    (!attentionCategory &&
      (emailType === "notification" || emailType === "newsletter" || emailType === "marketing"))

  const assistantInput = {
    id: conversation.id,
    externalThreadId: conversation.externalThreadId,
    label: conversation.label,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt,
    contact: conversation.contact,
    channel: conversation.channel,
    messages: conversation.messages,
    draft: conversation.draft,
    agentJobs: latestAgentJob ? [latestAgentJob] : [],
    approvalRequests: pendingApprovals,
    calendarHolds: activeHold ? [activeHold] : [],
    conversationState: stateRecord ?? null,
  };
  const assistantState = analyzeConversationForCommandCenter(assistantInput, new Date(), accountMode);
  const relationshipContext = buildRelationshipContext(assistantInput, new Date(), accountMode);
  const draftMetadata = (
    conversation.draft as {
      metadataJson?: {
        intent?: unknown;
        confidence?: unknown;
        riskLevel?: unknown;
        suggestedLabel?: unknown;
        escalationReason?: unknown;
      } | null;
    } | null
  )?.metadataJson;
  const activeDraft =
    conversation.draft &&
    conversation.draft.status !== "none" &&
    conversation.draft.status !== "sent" &&
    conversation.draft.text.trim()
      ? conversation.draft
      : null

  const vipBanner = isVip ? (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
      ⭐ VIP{vipLabel ? ` — ${vipLabel}` : ""}
    </div>
  ) : null

  const phishingBanner = phishingVerdict && phishingVerdict !== "safe" && !phishingMarkedSafe ? (
    <PhishingWarningBanner
      conversationId={conversation.id}
      verdict={phishingVerdict as "suspicious" | "likely_phishing"}
    />
  ) : null

  const unsubscribeButton = hasUnsubscribeLink ? (
    <UnsubscribeButton conversationId={conversation.id} />
  ) : null

  const snoozeButton = <SnoozeButton conversationId={conversation.id} />

  const resurfacedBanner = resurfacedFromSnooze ? (
    <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
      💤 This conversation was snoozed and has just resurfaced.
    </div>
  ) : null

  // Reusable sidebar panels shared between desktop and mobile layouts
  const contactCard = (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</p>
      {conversation.contact ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800" title={conversation.contact.name}>
            {conversation.contact.name}
          </p>
          {conversation.contact.phoneE164 && (
            <p className="truncate text-xs text-slate-500" title={conversation.contact.phoneE164}>
              {conversation.contact.phoneE164}
            </p>
          )}
        </div>
      ) : conversation.channel.type === "email" ? (
        <p className="text-xs text-slate-500">No contact saved</p>
      ) : (
        <SaveContactForm
          conversationId={conversation.id}
          phoneE164={conversation.externalThreadId}
        />
      )}
      {!isPersonal && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <LabelSelect
            conversationId={conversation.id}
            currentLabel={conversation.label}
            isPersonal={isPersonal}
          />
        </div>
      )}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <WorkflowStatusSelect
          conversationId={conversation.id}
          status={conversation.status}
          userState={conversation.userState}
          draftStatus={conversation.draft?.status ?? null}
          attentionCategory={attentionCategory}
          emailType={emailType}
        />
      </div>
    </div>
  )

  const assistantCard = isAutoEmailConversation ? (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
      <p className="font-medium text-slate-700">
        {attentionCategory === "quiet" ? "Quiet" : "No reply needed"}
      </p>
      <p className="mt-1 break-words [overflow-wrap:anywhere]">
        {attentionReason ??
          (emailType === "notification"
          ? "This is an automated notification."
          : emailType === "newsletter"
            ? "This is a newsletter or marketing email."
            : "This is a promotional email.")}
      </p>
    </div>
  ) : (
    <HandleThisPanel
      conversationId={conversation.id}
      assistantState={assistantState}
      canSuggest={canSuggestReply}
      isPersonal={isPersonal}
    />
  )

  const businessPanels = (
    <>
      {isSupport && !isPersonal && (
        <SupportPanel
          conversationId={conversation.id}
          isSupport={isSupport}
          churnRisk={churnRisk}
          needsEscalation={needsEscalation}
          suggestedKbDoc={suggestedKbDoc}
          repeatContactCount={0}
        />
      )}
      {isSalesLead && !isPersonal && (
        <SalesPanel
          conversationId={conversation.id}
          closingStage={closingStage}
          extractedBudget={extractedBudget}
          extractedTimeline={extractedTimeline}
          suggestedAction={salesSuggestedAction}
        />
      )}
      {conversation.channel.type === "email" && !isPersonal && !isAutoEmailConversation && (
        <CalendarHoldPanel
          conversationId={conversation.id}
          availableSlots={
            Array.isArray(latestAgentJob?.slotsJson)
              ? (latestAgentJob.slotsJson as string[])
              : []
          }
          primaryCalendarEmail={
            businessProfile?.primaryCalendarEmail ?? null
          }
          activeHold={activeHold}
        />
      )}
    </>
  )

  const cleanSummary = relationshipContext.lastConversationSummary

  const summaryCard = cleanSummary && cleanSummary !== "No recent conversation summary yet." ? (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</p>
      <p className="text-xs text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere]">{cleanSummary}</p>
    </div>
  ) : null

  const extraCards = isAutoEmailConversation ? null : (
    <>
      {summaryCard}
      {/* Second brain is deferred out of the MVP default path */}
      {!isPersonal && <SecondBrainPanel facts={secondBrainFacts} />}
      <ExplainThreadPanel conversationId={conversation.id} />
      <CollapsibleCard title="Work items">
        <WorkItemsPanel
          state={stateRecord}
          tasks={inboxTasks}
          lead={lead}
          conversationId={conversation.id}
          isPersonal={isPersonal}
          bare
        />
      </CollapsibleCard>
      {personMemory && (
        <CollapsibleCard title="Relationship">
          <div className="min-w-0 space-y-3 break-words text-xs text-slate-600 leading-relaxed [overflow-wrap:anywhere]">
            <p>{personMemory.summary}</p>
            {personMemory.promisedActions && (
              <div>
                <p className="mb-1 font-semibold text-slate-500">Promises made</p>
                <p className="whitespace-pre-line">{personMemory.promisedActions}</p>
              </div>
            )}
            {personMemory.openQuestions && (
              <div>
                <p className="mb-1 font-semibold text-slate-500">Open questions</p>
                <p className="whitespace-pre-line">{personMemory.openQuestions}</p>
              </div>
            )}
            {personMemory.preferences && (
              <div>
                <p className="mb-1 font-semibold text-slate-500">Preferences noted</p>
                <p className="whitespace-pre-line">{personMemory.preferences}</p>
              </div>
            )}
            {conversation.contactId && (
              <PersonMemoryEditShell
                contactId={conversation.contactId}
                memory={{
                  summary: personMemory.summary ?? null,
                  preferences: personMemory.preferences ?? null,
                  openQuestions: personMemory.openQuestions ?? null,
                  promisedActions: personMemory.promisedActions ?? null,
                }}
              />
            )}
          </div>
        </CollapsibleCard>
      )}
    </>
  )

  const phase4Panels = (
    <>
      {/* Scheduling agent is deferred out of the MVP default path — Sales & CRM
          mode only, even if a calendar credential survives a mode toggle */}
      {!isPersonal && calendarCredentials.length > 0 && (
        <SchedulingPanel
          conversationId={conversation.id}
          calendarEmails={calendarCredentials.map((c) => c.email)}
          initialSession={schedulingSession ? {
            id: schedulingSession.id,
            status: schedulingSession.status,
            proposedTimesJson: schedulingSession.proposedTimesJson as ProposedSlot[] | null,
            confirmedTime: schedulingSession.confirmedTime,
            calendarEmail: schedulingSession.calendarEmail,
            eventId: schedulingSession.eventId,
          } : null}
        />
      )}
      <ConversationTimeline entries={timelineEntries} />
      <AutomationRunHistory
        runs={automationRuns.map((r) => ({
          id: r.id,
          trigger: r.trigger,
          status: r.status,
          stepsJson: r.stepsJson as AutomationStep[],
          createdAt: r.createdAt.toISOString(),
          rolledBackAt: r.rolledBackAt?.toISOString() ?? null,
        }))}
      />
    </>
  )

  const replyComposer = (
    <div className="px-4 py-2">
      <ReplyComposer
        conversationId={conversation.id}
        channelType={conversation.channel.type}
        canSuggest={canSuggestReply}
        isPersonal={isPersonal}
        senderAddress={(() => {
          const lastInbound = [...conversation.messages].reverse().find(m => m.direction === "inbound")
          return lastInbound?.fromE164 ?? conversation.channel.emailAddress ?? undefined
        })()}
        threadSubject={conversation.externalThreadId}
        initialDraft={
          activeDraft
            ? {
                id: activeDraft.id,
                text: activeDraft.text,
                status: activeDraft.status,
                metadataJson: draftMetadata ?? null,
              }
            : null
        }
        conciergeTemplates={conciergeTemplates.length > 0 ? conciergeTemplates : undefined}
      />
    </div>
  )

  return (
    <>
      <AutoRefresh intervalMs={60000} />

      {/* ── DESKTOP SHELL (lg+) ── */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={railPendingApprovals} />
        <DesktopResizablePanels
          storageKey="flowdesk.conversation.desktopPanels"
          left={
            <AppListColumn
              tenantId={session.user.tenantId}
              accountType={accountType}
              activeConversationId={conversation.id}
              status={returnStatus}
              q={returnQuery}
              sales={returnSales}
              gmailChannels={gmailSyncChannels}
              className="w-full shrink-0"
            />
          }
          main={
            <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
              {/* Sticky thread header */}
              <div className="shrink-0 border-b border-slate-200 px-5 py-3">
                <ThreadStatusHeader
                  conversationId={conversation.id}
                  initialStatus={conversation.status}
                  displayName={displayName}
                  channelAddress={conversation.channel.emailAddress ?? conversation.externalThreadId}
                  label={conversation.label}
                  isPersonal={isPersonal}
                  isAutoEmail={isAutoEmailConversation}
                  isRead={Boolean(conversation.readAt)}
                  isGmail={conversation.channel.provider === "google"}
                />
              </div>

              {/* Scrollable messages */}
              <div className="flex-1 overflow-y-auto px-2 py-3">
                <div className="space-y-4">
                  {conversation.messages.length === 0 ? (
                    <p className="text-sm text-slate-500">No messages yet.</p>
                  ) : (
                    conversation.messages.map((message) => {
                      const isOutbound = message.direction === "outbound";
                      return (
                        <article
                          key={message.id}
                          className={`overflow-hidden rounded-xl border px-3 py-2.5 ${
                            isOutbound ? "border-blue-100 bg-blue-50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                                {isOutbound ? "Me" : initialsFor(message.fromE164)}
                              </div>
                              <div className="min-w-0">
                                <p className="min-w-0 break-all text-xs font-semibold text-slate-900">
                                  {isOutbound ? "You" : message.fromE164}
                                </p>
                                <p className="min-w-0 break-all text-[11px] text-slate-500">
                                  To: {message.toE164}
                                </p>
                              </div>
                            </div>
                            <time className="shrink-0 text-[11px] text-slate-400" dateTime={message.createdAt.toISOString()}>
                              {message.createdAt.toLocaleString()}
                            </time>
                          </div>
                          <div className="min-w-0 text-sm leading-relaxed text-slate-900">
                            <EmailBody body={message.body} />
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Reply composer — anchored at bottom, full thread-column width */}
              <div className="shrink-0 border-t border-slate-200 bg-white">
                {replyComposer}
              </div>
            </div>
          }
          right={
            <div className="space-y-2.5">
              {vipBanner}
              {phishingBanner}
              {resurfacedBanner}
              {unsubscribeButton}
              {snoozeButton}
              {contactCard}
              {assistantCard}
              {businessPanels}
              {extraCards}
              {phase4Panels}
            </div>
          }
        />
      </div>

      {/* ── MOBILE LAYOUT (< lg) ── */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 sm:px-6 py-4">
            <div className="min-w-0">
              <Link href={inboxReturnPath} className="text-sm text-slate-500 hover:text-slate-700">
                ← Back to inbox
              </Link>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-xl font-semibold">{displayName}</h1>
                <StatusBadge status={isAutoEmailConversation ? "closed" : conversation.status} />
                {conversation.label && !isPersonal && <LabelBadge label={conversation.label} />}
              </div>
              <p className="min-w-0 break-all text-sm text-slate-500">
                {conversation.channel.emailAddress ?? conversation.externalThreadId}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <MarkReadButton conversationId={conversation.id} isRead={Boolean(conversation.readAt)} />
              {!isPersonal && (
                <StatusButton conversationId={conversation.id} currentStatus={conversation.status} />
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1200px] gap-6 px-4 sm:px-6 py-6 lg:grid-cols-[1fr_320px]">
          <section className="min-w-0 space-y-4 overflow-hidden">
            <div className="overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email thread</p>
                <h2 className="mt-1 min-w-0 break-words text-lg font-semibold text-slate-950 [overflow-wrap:anywhere]">
                  {displayName}
                </h2>
                <p className="mt-1 min-w-0 break-all text-sm text-slate-500">
                  {conversation.channel.emailAddress
                    ? `Inbox: ${conversation.channel.emailAddress}`
                    : `Thread: ${conversation.externalThreadId}`}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {conversation.messages.length === 0 ? (
                  <p className="px-6 py-5 text-sm text-slate-500">No messages yet.</p>
                ) : (
                  conversation.messages.map((message) => {
                    const isOutbound = message.direction === "outbound";
                    return (
                      <article key={message.id} className="px-4 py-4">
                        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-start">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                            {isOutbound ? "Me" : initialsFor(message.fromE164)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <p className="min-w-0 break-all font-semibold text-slate-900">
                                {isOutbound ? "You" : message.fromE164}
                              </p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                                {isOutbound ? "Sent" : "Received"}
                              </span>
                            </div>
                            <p className="mt-1 min-w-0 break-all text-xs text-slate-500">
                              To: {message.toE164}
                            </p>
                          </div>
                          <time className="text-xs text-slate-400 sm:text-right" dateTime={message.createdAt.toISOString()}>
                            {message.createdAt.toLocaleString()}
                          </time>
                        </div>
                        <div className="min-w-0 text-sm leading-6 text-slate-900">
                          <EmailBody body={message.body} />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="overflow-hidden">
              {replyComposer}
            </div>
          </section>

          <aside className="min-w-0 space-y-3">
            {vipBanner}
            {phishingBanner}
            {resurfacedBanner}
            {unsubscribeButton}
            {snoozeButton}
            {contactCard}
            {assistantCard}
            {businessPanels}
            {extraCards}
            {phase4Panels}
          </aside>
        </main>
      </div>
    </>
  );
}

function initialsFor(value: string): string {
  const name = value.replace(/<.*?>/g, "").trim() || value
  const first = name.match(/[A-Za-z0-9]/)?.[0] ?? "?"
  return first.toUpperCase()
}
