import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buildBatchToken } from "@/lib/clean-inbox-token"
import { isSafeUnsubscribeUrl } from "@/lib/agent/unsubscribe"
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata"
import { revalidateInboxViews } from "@/lib/cache-tags"
import { archiveConversationsInProviderMailbox } from "@/lib/clean-inbox-email"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    include: {
      stateRecord: { select: { metadataJson: true } },
      channel: { select: { provider: true } },
    },
  })

  let unsubscribed = 0
  for (const conv of convs) {
    const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null
    const url = typeof meta?.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null
    if (url && isSafeUnsubscribeUrl(url)) {
      fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
      unsubscribed++
    }
  }

  const ids = convs.map((c) => c.id)
  const now = new Date()

  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { id: { in: ids }, tenantId },
      data: {
        status: "closed",
        readAt: now,
        gmailUnread: false,
        userState: "done",
        userStateSource: "user",
        userStateUpdatedAt: now,
      },
    }),
    prisma.message.updateMany({
      where: { conversationId: { in: ids } },
      data: { isRead: true },
    }),
    ...convs.map((conv) => {
      const prevMeta =
        conv.stateRecord?.metadataJson &&
        typeof conv.stateRecord.metadataJson === "object" &&
        !Array.isArray(conv.stateRecord.metadataJson)
          ? (conv.stateRecord.metadataJson as Record<string, unknown>)
          : {}
      const metadataJson = {
        ...prevMeta,
        cleanInboxArchived: true,
        cleanInboxArchivedAt: now.toISOString(),
        cleanInboxUnsubscribed: true,
        userOverride: true,
        userState: "done",
        updatedAt: now.toISOString(),
      }
      return prisma.conversationState.upsert({
        where: { conversationId: conv.id },
        create: {
          tenantId,
          conversationId: conv.id,
          state: "done",
          priority: "none",
          reason: "Unsubscribed and archived from Clean Inbox.",
          nextAction: "No action needed.",
          confidence: 1,
          source: "user_override",
          metadataJson,
          ...conversationStateMetadataData(metadataJson),
        },
        update: {
          state: "done",
          priority: "none",
          reason: "Unsubscribed and archived from Clean Inbox.",
          nextAction: "No action needed.",
          confidence: 1,
          source: "user_override",
          metadataJson,
          ...conversationStateMetadataData(metadataJson),
        },
      })
    }),
  ])

  // Archive the threads in the provider mailbox too (best-effort), so
  // "unsubscribe + archive" clears the real inbox rather than only closing
  // the FlowDesk row.
  const gmailArchive = await archiveConversationsInProviderMailbox(convs)

  const batchToken = buildBatchToken(ids)
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.unsubscribe_batch",
      payloadJson: {
        batchToken,
        conversationIds: ids,
        previousStatuses: Object.fromEntries(convs.map((c) => [c.id, c.status])),
        unsubscribed,
        gmailArchived: gmailArchive.archived,
        gmailArchiveFailed: gmailArchive.failed,
      } as Prisma.InputJsonValue,
    },
  })

  revalidateInboxViews(tenantId)
  return NextResponse.json({ ok: true, processed: convs.length, unsubscribed, batchToken })
}
