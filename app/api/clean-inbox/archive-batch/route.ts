import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buildBatchToken } from "@/lib/clean-inbox-token"
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
    select: {
      id: true,
      status: true,
      channelId: true,
      externalThreadId: true,
      channel: { select: { provider: true } },
      stateRecord: { select: { metadataJson: true } },
    },
  })
  const validIds = convs.map((c) => c.id)
  const now = new Date()

  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { id: { in: validIds }, tenantId },
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
      where: { conversationId: { in: validIds } },
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
          reason: "Archived from Clean Inbox.",
          nextAction: "No action needed.",
          confidence: 1,
          source: "user_override",
          metadataJson,
          ...conversationStateMetadataData(metadataJson),
        },
        update: {
          state: "done",
          priority: "none",
          reason: "Archived from Clean Inbox.",
          nextAction: "No action needed.",
          confidence: 1,
          source: "user_override",
          metadataJson,
          ...conversationStateMetadataData(metadataJson),
        },
      })
    }),
  ])

  // Actually archive in the provider mailbox (Gmail: remove INBOX; Outlook:
  // move out of Inbox) so cleanup leaves the user's real inbox, not just the
  // FlowDesk row. Best-effort and per-thread isolated: a provider failure on
  // one thread never fails the whole batch.
  const gmailArchive = await archiveConversationsInProviderMailbox(convs)

  const batchToken = buildBatchToken(validIds)

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.archive_batch",
      payloadJson: {
        batchToken,
        conversationIds: validIds,
        previousStatuses: Object.fromEntries(convs.map((c) => [c.id, c.status])),
        count: validIds.length,
        gmailArchived: gmailArchive.archived,
        gmailArchiveFailed: gmailArchive.failed,
      } as Prisma.InputJsonValue,
    },
  })

  revalidateInboxViews(tenantId)
  return NextResponse.json({ ok: true, archived: validIds.length, batchToken })
}
