import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import RecentEmailHistory from "@/app/assistant/RecentEmailHistory"
import RuleHistoryList from "@/app/assistant/RuleHistoryList"
import { authOptions } from "@/lib/auth"
import { currentFlowDeskLabel } from "@/lib/flowdesk-label-display"
import { prisma } from "@/lib/prisma"
import { deriveWorkflowStatus } from "@/lib/workflow-status"

export const dynamic = "force-dynamic"

const RULE_AUDIT_ACTIONS = ["agent_rule.create", "agent_rule.update", "agent_rule.version_snapshot", "agent_rule.delete", "agent_rule.dry_run"]

export default async function AssistantHistoryPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const [recentConversations, auditEntriesRaw] = await Promise.all([
    prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
      include: {
        contact: { select: { name: true, phoneE164: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { subject: true, createdAt: true } },
        draft: { select: { status: true } },
        stateRecord: { select: { attentionCategory: true, emailType: true } },
      },
    }),
    prisma.auditLog.findMany({ where: { tenantId, action: { in: RULE_AUDIT_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ])

  const recentRows = recentConversations.map((conversation) => {
    const workflowStatus = deriveWorkflowStatus({ status: conversation.status, userState: conversation.userState, draftStatus: conversation.draft?.status, attentionCategory: conversation.stateRecord?.attentionCategory, emailType: conversation.stateRecord?.emailType })
    return {
      id: conversation.id,
      sender: conversation.contact?.name ?? conversation.contact?.phoneE164 ?? "Unknown sender",
      senderEmail: conversation.contact?.phoneE164 ?? null,
      subject: conversation.messages[0]?.subject ?? "(No subject)",
      receivedAt: (conversation.messages[0]?.createdAt ?? conversation.lastMessageAt).toISOString(),
      label: currentFlowDeskLabel(conversation.stateRecord?.attentionCategory, conversation.stateRecord?.emailType, workflowStatus),
    }
  })
  const auditEntries = auditEntriesRaw.map((entry) => ({ id: entry.id, action: entry.action, createdAt: entry.createdAt.toISOString(), payloadJson: entry.payloadJson }))

  return <section><h2 className="text-lg font-semibold text-slate-900">Recent emails</h2><p className="mb-4 text-sm text-slate-500">Review the latest 20 emails and correct labels so FlowDesk learns your preferences.</p><RecentEmailHistory initialRows={recentRows} /><details className="mt-6 rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Rule change history</summary><div className="mt-4"><RuleHistoryList entries={auditEntries} /></div></details></section>
}
