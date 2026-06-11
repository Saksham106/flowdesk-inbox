import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AIDraftPanel from "@/app/conversations/[id]/AIDraftPanel";
import CalendarHoldPanel from "@/app/conversations/[id]/CalendarHoldPanel";
import HandleThisPanel from "@/app/conversations/[id]/HandleThisPanel";
import SendBox from "@/app/conversations/[id]/SendBox";
import StatusButton from "@/app/conversations/[id]/StatusButton";
import LabelSelect from "@/app/conversations/[id]/LabelSelect";
import SaveContactForm from "@/app/conversations/[id]/SaveContactForm";
import AutoRefresh from "@/app/components/AutoRefresh";
import { StatusBadge, LabelBadge } from "@/app/components/badges";
import {
  analyzeConversationForCommandCenter,
  buildRelationshipContext,
} from "@/lib/agent/command-center";

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

  const [
    conversation,
    businessProfile,
    knowledgeDocumentCount,
    latestAgentJob,
    activeHold,
    pendingApprovals,
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
  ]);

  if (!conversation) {
    notFound();
  }

  const displayName = conversation.contact?.name ?? conversation.externalThreadId;
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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-xl font-semibold">{displayName}</h1>
              <StatusBadge status={conversation.status} />
              {conversation.label && <LabelBadge label={conversation.label} />}
            </div>
            <p className="text-sm text-slate-500">
              {conversation.channel.emailAddress ?? conversation.externalThreadId}
            </p>
          </div>
          <StatusButton
            conversationId={conversation.id}
            currentStatus={conversation.status}
          />
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[1fr_280px]">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
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
                      className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                        isOutbound
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      <p>{message.body}</p>
                      <p className="mt-1 text-xs opacity-70">
                        {message.createdAt.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className="space-y-4">
          {/* Contact */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-600">Contact</h2>
            {conversation.contact ? (
              <div className="min-w-0 space-y-0.5">
                <p
                  className="truncate text-sm font-medium"
                  title={conversation.contact.name}
                >
                  {conversation.contact.name}
                </p>
                <p className="text-xs font-medium text-slate-500">
                  {conversation.channel.type === "email" ? "Email" : "Phone"}:
                </p>
                <p
                  className="truncate text-xs text-slate-500"
                  title={conversation.contact.phoneE164}
                >
                  {conversation.contact.phoneE164}
                </p>
              </div>
            ) : conversation.channel.type === "email" ? (
              <p className="text-sm text-slate-500">No contact saved</p>
            ) : (
              <SaveContactForm
                conversationId={conversation.id}
                phoneE164={conversation.externalThreadId}
              />
            )}
          </div>

          {/* Label */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-600">Label</h2>
            <LabelSelect
              conversationId={conversation.id}
              currentLabel={conversation.label}
            />
          </div>

          {/* AI Draft */}
          <HandleThisPanel
            conversationId={conversation.id}
            assistantState={assistantState}
            relationshipContext={relationshipContext}
            canSuggest={conversation.channel.type === "email" && Boolean(businessProfile)}
          />

          {/* AI Draft */}
          <AIDraftPanel
            conversationId={conversation.id}
            channelType={conversation.channel.type}
            hasBusinessProfile={Boolean(businessProfile)}
            knowledgeDocumentCount={knowledgeDocumentCount}
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
          />

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

          {/* Send */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-600">Send reply</h2>
            <SendBox conversationId={conversation.id} />
          </div>
        </aside>
      </main>
    </div>
  );
}
