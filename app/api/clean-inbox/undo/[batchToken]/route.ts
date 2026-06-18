import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { parseBatchToken } from "@/lib/clean-inbox-token"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import { revalidateInboxViews } from "@/lib/cache-tags"

export async function POST(
  _request: Request,
  { params }: { params: { batchToken: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const ids = parseBatchToken(params.batchToken)
  if (ids.length === 0) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 })

  // Verify within 1-hour window via auditLog
  const log = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      action: { in: ["clean_inbox.archive_batch", "clean_inbox.unsubscribe_batch"] },
      payloadJson: { path: ["batchToken"], equals: params.batchToken },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  })
  if (!log) return NextResponse.json({ error: "Undo window expired (1 hour)" }, { status: 410 })

  const payload =
    log.payloadJson && typeof log.payloadJson === "object" && !Array.isArray(log.payloadJson)
      ? (log.payloadJson as Record<string, unknown>)
      : {}
  const previousStatuses =
    payload.previousStatuses && typeof payload.previousStatuses === "object" && !Array.isArray(payload.previousStatuses)
      ? (payload.previousStatuses as Record<string, unknown>)
      : {}
  const conversations = await prisma.conversation.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, stateRecord: { select: { metadataJson: true } } },
  })
  const now = new Date()

  await prisma.$transaction(
    conversations.flatMap((conversation) => {
      const restoredStatus =
        previousStatuses[conversation.id] === "in_progress" || previousStatuses[conversation.id] === "closed"
          ? (previousStatuses[conversation.id] as "in_progress" | "closed")
          : "needs_reply"
      const prevMeta =
        conversation.stateRecord?.metadataJson &&
        typeof conversation.stateRecord.metadataJson === "object" &&
        !Array.isArray(conversation.stateRecord.metadataJson)
          ? (conversation.stateRecord.metadataJson as Record<string, unknown>)
          : {}
      const metadataJson = {
        ...prevMeta,
        cleanInboxArchived: false,
        cleanInboxUndoneAt: now.toISOString(),
        userOverride: true,
        userState: restoredStatus === "closed" ? "done" : restoredStatus,
        updatedAt: now.toISOString(),
      }
      const state = restoredStatus === "closed" ? "done" : restoredStatus === "in_progress" ? "waiting_on_them" : "needs_reply"
      return [
        prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: restoredStatus,
            userState: restoredStatus === "closed" ? "done" : restoredStatus,
            userStateSource: "user",
            userStateUpdatedAt: now,
          },
        }),
        prisma.conversationState.upsert({
          where: { conversationId: conversation.id },
          create: {
            tenantId,
            conversationId: conversation.id,
            state,
            priority: restoredStatus === "closed" ? "none" : "high",
            reason: "Restored from Clean Inbox undo.",
            nextAction: restoredStatus === "closed" ? "No action needed." : "Review the conversation.",
            confidence: 1,
            source: "user_override",
            metadataJson,
            ...conversationStateMetadataData(metadataJson),
          },
          update: {
            state,
            priority: restoredStatus === "closed" ? "none" : "high",
            reason: "Restored from Clean Inbox undo.",
            nextAction: restoredStatus === "closed" ? "No action needed." : "Review the conversation.",
            confidence: 1,
            source: "user_override",
            metadataJson,
            ...conversationStateMetadataData(metadataJson),
          },
        }),
      ]
    })
  )

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.undo",
      payloadJson: { batchToken: params.batchToken, restoredCount: conversations.length } as Prisma.InputJsonValue,
    },
  })

  revalidateInboxViews(tenantId)
  return NextResponse.json({ ok: true, restored: conversations.length })
}
