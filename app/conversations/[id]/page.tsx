import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AIDraftPanel from "@/app/conversations/[id]/AIDraftPanel";
import CalendarHoldPanel from "@/app/conversations/[id]/CalendarHoldPanel";
import ExplainThreadPanel from "@/app/conversations/[id]/ExplainThreadPanel";
import HandleThisPanel from "@/app/conversations/[id]/HandleThisPanel";
import WorkItemsPanel from "@/app/conversations/[id]/WorkItemsPanel";
import SendBox from "@/app/conversations/[id]/SendBox";
import StatusButton from "@/app/conversations/[id]/StatusButton";
import LabelSelect from "@/app/conversations/[id]/LabelSelect";
import SaveContactForm from "@/app/conversations/[id]/SaveContactForm";
import AutoDraftTrigger from "@/app/conversations/[id]/AutoDraftTrigger";
import AutoRefresh from "@/app/components/AutoRefresh";
import CollapsibleCard from "@/app/components/CollapsibleCard";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import {
  analyzeConversationForCommandCenter,
  buildRelationshipContext,
} from "@/lib/agent/command-center";
import { syncConversationWorkItems } from "@/lib/agent/work-item-sync";
import SupportPanel from "@/app/conversations/[id]/SupportPanel";
import SalesPanel from "@/app/conversations/[id]/SalesPanel";
import { SALES_SUGGESTED_ACTIONS } from "@/lib/agent/sales-classifier";
import EmailBody from "@/app/components/EmailBody";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    redirect("/login");
  }

  const isPersonal =
    (session.user as Record<string, unknown>).accountType === "personal";

  const [
    conversation,
    businessProfile,
    knowledgeDocumentCount,
    latestAgentJob,
    activeHold,
    pendingApprovals,
    pendingFollowUpJob,
  ] = await Promise.all([
    prisma.conversation.findFirst({
      where: {
        id: params.id,
        tenantId: session.user.tenantId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        channel: true,
        contact: true,
        draft: true,
      },
    }),
    prisma.businessProfile.findUnique({
      where: { tenantId: session.user.tenantId },
      select: { id: true },
    }),
    prisma.knowledgeDocument.count({
      where: { tenantId: session.user.tenantId },
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
    prisma.agentJob.findFirst({
      where: { conversationId: params.id, tenantId: session.user.tenantId, trigger: "follow_up", status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);

  if (!conversation) {
    notFound();
  }

  await syncConversationWorkItems({
    tenantId: session.user.tenantId,
    conversationId: conversation.id,
  }).catch(() => null);

  const [stateRecord, inboxTasks, lead, personMemory] = await Promise.all([
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
          },
        })
      : null,
  ]);

  const convMeta =
    stateRecord?.metadataJson &&
    typeof stateRecord.metadataJson === "object" &&
    !Array.isArray(stateRecord.metadataJson)
      ? (stateRecord.metadataJson as Record<string, unknown>)
      : {}

  const isSupport = convMeta.isSupport === true
  const churnRisk = convMeta.churnRisk === true
  const needsEscalation = convMeta.needsEscalation === true
  const suggestedKbDocId =
    typeof convMeta.suggestedKbDocId === "string" ? convMeta.suggestedKbDocId : null

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

  const shouldAutoFollowUp =
    Boolean(pendingFollowUpJob) &&
    !conversation.draft &&
    conversation.channel.type === "email" &&
    Boolean(businessProfile);

  const displayName = conversation.contact?.name ?? conversation.externalThreadId;
  const emailType =
    typeof convMeta.emailType === "string" ? convMeta.emailType : null
  const isAutoEmailConversation =
    emailType === "notification" || emailType === "newsletter" || emailType === "marketing"

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
  const assistantState = analyzeConversationForCommandCenter(assistantInput);
  const relationshipContext = buildRelationshipContext(assistantInput);
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

  return (
    <div className="min-h-screen bg-slate-50">
      <AutoRefresh intervalMs={8000} />
      {shouldAutoFollowUp && <AutoDraftTrigger conversationId={conversation.id} />}

      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 sm:px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-xl font-semibold">{displayName}</h1>
              <StatusBadge status={isAutoEmailConversation || stateRecord?.state === "fyi_only" ? "closed" : conversation.status} />
              {conversation.label && <LabelBadge label={conversation.label} />}
            </div>
            <p className="min-w-0 break-all text-sm text-slate-500">
              {conversation.channel.emailAddress ?? conversation.externalThreadId}
            </p>
          </div>
          <StatusButton
            conversationId={conversation.id}
            currentStatus={conversation.status}
          />
        </div>
      </header>

      {/* Two-column layout: email thread + composer | context sidebar */}
      <main className="mx-auto grid max-w-[1200px] gap-6 px-4 sm:px-6 py-6 lg:grid-cols-[1fr_320px]">

        {/* Left: conversation thread then inline reply composer */}
        <section className="min-w-0 space-y-4 overflow-hidden">
          {/* Email thread */}
          <div className="overflow-x-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              {conversation.messages.length === 0 ? (
                <p className="text-sm text-slate-500">No messages yet.</p>
              ) : (
                conversation.messages.map((message) => {
                  const isOutbound = message.direction === "outbound";
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] min-w-0 rounded-2xl px-4 py-2 text-sm ${
                          isOutbound
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-900"
                        }`}
                      >
                        <EmailBody body={message.body} />
                        <p className="mt-1 text-xs opacity-70">
                          {message.createdAt.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Inline reply composer — reads naturally below the last message */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Reply</h2>
              <p className="text-xs text-slate-500">
                Review and approve before anything is sent.
              </p>
            </div>

            {/* AI draft section */}
            <div className="px-6 py-5">
              <AIDraftPanel
                conversationId={conversation.id}
                channelType={conversation.channel.type}
                hasBusinessProfile={Boolean(businessProfile)}
                knowledgeDocumentCount={knowledgeDocumentCount}
                isPersonal={isPersonal}
                initialDraft={
                  conversation.draft
                    ? {
                        id: conversation.draft.id,
                        text: conversation.draft.text,
                        status: conversation.draft.status,
                        metadataJson: draftMetadata ?? null,
                      }
                    : null
                }
                inline
              />
            </div>

            {/* Quick send — simple direct path below the AI draft */}
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Or send directly
              </p>
              <SendBox conversationId={conversation.id} />
            </div>
          </div>
        </section>

        {/* Right: compact context sidebar */}
        <aside className="min-w-0 space-y-3">

          {/* Contact + Label — combined compact card */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Contact
              </p>
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
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <LabelSelect
                conversationId={conversation.id}
                currentLabel={conversation.label}
                isPersonal={isPersonal}
              />
            </div>
          </div>

          {/* Assistant context */}
          {isAutoEmailConversation ? (
            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              <p className="font-medium text-slate-700">No reply needed</p>
              <p className="mt-1 break-words [overflow-wrap:anywhere]">
                {emailType === "notification"
                  ? "This is an automated notification."
                  : emailType === "newsletter"
                    ? "This is a newsletter or marketing email."
                    : "This is a promotional email."}
              </p>
            </div>
          ) : (
            <HandleThisPanel
              conversationId={conversation.id}
              assistantState={assistantState}
              relationshipContext={relationshipContext}
              canSuggest={conversation.channel.type === "email" && Boolean(businessProfile)}
              isPersonal={isPersonal}
            />
          )}

          {/* Business-only: support signals */}
          {isSupport && (
            <SupportPanel
              conversationId={conversation.id}
              isSupport={isSupport}
              churnRisk={churnRisk}
              needsEscalation={needsEscalation}
              suggestedKbDoc={suggestedKbDoc}
              repeatContactCount={0}
            />
          )}

          {/* Business-only: sales pipeline */}
          {isSalesLead && !isPersonal && (
            <SalesPanel
              conversationId={conversation.id}
              closingStage={closingStage}
              extractedBudget={extractedBudget}
              extractedTimeline={extractedTimeline}
              suggestedAction={salesSuggestedAction}
            />
          )}

          {/* Calendar holds */}
          {conversation.channel.type === "email" && (
            <CalendarHoldPanel
              conversationId={conversation.id}
              availableSlots={
                Array.isArray(latestAgentJob?.slotsJson)
                  ? (latestAgentJob.slotsJson as string[])
                  : []
              }
              primaryCalendarEmail={
                (businessProfile as { primaryCalendarEmail?: string | null } | null)
                  ?.primaryCalendarEmail ?? null
              }
              activeHold={activeHold}
            />
          )}

          {/* Explain thread — already starts in minimal "click to expand" state */}
          <ExplainThreadPanel conversationId={conversation.id} />

          {/* Work items — collapsible to keep sidebar compact */}
          <CollapsibleCard title="Work items">
            <WorkItemsPanel
              state={stateRecord}
              tasks={inboxTasks}
              lead={lead}
              isPersonal={isPersonal}
              bare
            />
          </CollapsibleCard>

          {/* Relationship memory — collapsible */}
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
              </div>
            </CollapsibleCard>
          )}
        </aside>
      </main>
    </div>
  );
}
