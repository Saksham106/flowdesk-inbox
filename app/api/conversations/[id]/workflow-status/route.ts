// app/api/conversations/[id]/workflow-status/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { revalidateInboxViews } from "@/lib/cache-tags"
import {
  conversationUpdateForWorkflowStatus,
  shouldClearDraftForWorkflowStatus,
  type SettableWorkflowStatus,
} from "@/lib/workflow-status-transitions"
import {
  flowDeskLabelsForConversationState,
  queueFlowDeskLabelWriteback,
} from "@/lib/gmail-labels"
import { queueGmailDraftWithdrawal } from "@/lib/gmail-drafts"

const SETTABLE_STATUSES = new Set(["needs_reply", "waiting_on", "read_later", "done"])

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { workflowStatus?: string }
  const { workflowStatus } = body

  if (!workflowStatus || !SETTABLE_STATUSES.has(workflowStatus)) {
    return NextResponse.json({ error: "Invalid workflowStatus" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      label: true,
      draft: { select: { status: true } },
      stateRecord: { select: { attentionCategory: true } },
      channel: { select: { provider: true } },
    },
  })
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const settableWorkflowStatus = workflowStatus as SettableWorkflowStatus

  await prisma.conversation.update({
    where: { id: params.id, tenantId: session.user.tenantId },
    data: conversationUpdateForWorkflowStatus(settableWorkflowStatus),
  })

  if (shouldClearDraftForWorkflowStatus(settableWorkflowStatus)) {
    await prisma.draft.updateMany({
      where: {
        conversationId: params.id,
        status: { in: ["proposed", "approved"] },
        conversation: { tenantId: session.user.tenantId },
      },
      data: {
        status: "none",
        text: "",
      },
    })
  }

  if (conversation.channel.provider === "google") {
    await queueFlowDeskLabelWriteback({
      tenantId: session.user.tenantId,
      channelId: conversation.channelId,
      conversationId: params.id,
      threadId: conversation.externalThreadId,
      labels: flowDeskLabelsForConversationState({
        workflowStatus: settableWorkflowStatus,
        localLabel: conversation.label,
        draftStatus: shouldClearDraftForWorkflowStatus(settableWorkflowStatus)
          ? null
          : conversation.draft?.status,
        attentionCategory: conversation.stateRecord?.attentionCategory,
      }),
      reason: `workflow_status.${settableWorkflowStatus}`,
    })

    // If we just cleared the draft, withdraw any Gmail-native draft too so a
    // stale reply isn't left waiting in the mailbox.
    if (shouldClearDraftForWorkflowStatus(settableWorkflowStatus)) {
      await queueGmailDraftWithdrawal({
        tenantId: session.user.tenantId,
        channelId: conversation.channelId,
        conversationId: params.id,
      })
    }
  }

  revalidateInboxViews(session.user.tenantId, params.id)
  return NextResponse.json({ ok: true })
}
