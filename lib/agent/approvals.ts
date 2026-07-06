import { prisma } from "@/lib/prisma"
import { queueGmailDraftWithdrawal } from "@/lib/gmail-drafts"

/**
 * ApprovalRequest is the single approval primitive (audit P2-3 / §9d): every
 * draft that reaches `proposed` gets exactly one pending ApprovalRequest, and
 * every path that approves, sends, rejects, or clears the draft resolves it.
 * Draft.status stays as a derived projection of the decision.
 */

export const APPROVAL_STEP_SEND = "send"

export type ApprovalResolution = "approved" | "rejected" | "cancelled"

/**
 * Ensures a single pending ApprovalRequest exists for a proposed draft.
 * Idempotent: re-proposing/regenerating a draft (Draft is unique per
 * conversation, so the draft id is stable) reuses the existing pending row —
 * the draft text lives on Draft, so the pending request stays current.
 */
export async function ensureDraftApprovalRequest(input: {
  tenantId: string
  conversationId: string
  draftId: string
  source: string
  agentJobId?: string | null
}) {
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      tenantId: input.tenantId,
      draftId: input.draftId,
      step: APPROVAL_STEP_SEND,
      status: "pending",
    },
  })
  if (existing) return existing

  return prisma.approvalRequest.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      draftId: input.draftId,
      step: APPROVAL_STEP_SEND,
      metadataJson: { source: input.source },
      ...(input.agentJobId ? { agentJobId: input.agentJobId } : {}),
    },
  })
}

/**
 * Resolves all pending ApprovalRequests for a draft. Used by the routes that
 * decide a draft's fate outside the /approvals queue (approve, send, clear) so
 * the queue never shows stale pending work. Writes one audit row when anything
 * was actually resolved.
 */
export async function resolveDraftApprovalRequests(input: {
  tenantId: string
  draftId: string
  resolution: ApprovalResolution
  reviewerUserId?: string | null
  note?: string
}): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: {
      tenantId: input.tenantId,
      draftId: input.draftId,
      status: "pending",
    },
    data: {
      status: input.resolution,
      decidedAt: new Date(),
      ...(input.reviewerUserId ? { reviewerUserId: input.reviewerUserId } : {}),
      ...(input.note !== undefined ? { decisionNote: input.note } : {}),
    },
  })

  if (result.count > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.reviewerUserId ?? null,
        action: "approval_request.resolved",
        payloadJson: {
          draftId: input.draftId,
          resolution: input.resolution,
          count: result.count,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      },
    })
  }

  return result.count
}

/**
 * Projects an approval decision back onto the draft (Draft.status is the
 * derived projection of the ApprovalRequest decision): approving marks the
 * draft approved so send-approved can send it; rejecting clears it and
 * withdraws any Gmail-native draft that was pushed for it.
 */
export async function projectDecisionOntoDraft(input: {
  tenantId: string
  draftId: string
  conversationId: string
  decision: "approved" | "rejected"
}) {
  if (input.decision === "approved") {
    await prisma.draft.updateMany({
      where: { id: input.draftId, conversation: { tenantId: input.tenantId } },
      data: { status: "approved" },
    })
    return
  }

  await prisma.draft.updateMany({
    where: { id: input.draftId, conversation: { tenantId: input.tenantId } },
    data: { status: "none" },
  })

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    select: { channelId: true, channel: { select: { provider: true } } },
  })
  if (conversation?.channel?.provider === "google") {
    await queueGmailDraftWithdrawal({
      tenantId: input.tenantId,
      channelId: conversation.channelId,
      conversationId: input.conversationId,
    })
  }
}
