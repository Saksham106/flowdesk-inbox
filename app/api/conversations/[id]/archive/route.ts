import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWritebackAdapter } from "@/lib/email/writeback-adapter";
import { conversationStateMetadataData } from "@/lib/agent/conversation-state-metadata";
import { revalidateInboxViews } from "@/lib/cache-tags";

export async function PATCH(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: {
      id: true,
      channelId: true,
      externalThreadId: true,
      channel: { select: { provider: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adapter = getWritebackAdapter(conversation.channel.provider);
  if (!adapter || !conversation.externalThreadId) {
    return NextResponse.json(
      { error: "Archive is not supported for this channel" },
      { status: 400 }
    );
  }

  await adapter.archiveConversation(conversation.channelId, conversation.externalThreadId);

  const now = new Date();

  // Preserve existing metadata, mark as user override so sync doesn't reopen
  const existingState = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  });
  const prevMeta =
    existingState?.metadataJson &&
    typeof existingState.metadataJson === "object" &&
    !Array.isArray(existingState.metadataJson)
      ? (existingState.metadataJson as Record<string, unknown>)
      : {};
  const metadataJson = { ...prevMeta, userOverride: true, userState: "done", archivedAt: now.toISOString(), updatedAt: now.toISOString() };

  await Promise.all([
    prisma.conversation.update({
      where: { id: params.id },
      data: { status: "closed", gmailUnread: false, readAt: now },
    }),
    prisma.conversationState.upsert({
      where: { conversationId: params.id },
      create: {
        tenantId: session.user.tenantId,
        conversationId: params.id,
        state: "done",
        priority: "none",
        reason: "User archived the conversation.",
        nextAction: "No action needed.",
        confidence: 1,
        source: "user_override",
        metadataJson,
        ...conversationStateMetadataData(metadataJson),
      },
      update: {
        state: "done",
        priority: "none",
        reason: "User archived the conversation.",
        nextAction: "No action needed.",
        confidence: 1,
        source: "user_override",
        metadataJson,
        ...conversationStateMetadataData(metadataJson),
      },
    }),
  ]);

  revalidateInboxViews(session.user.tenantId, params.id);
  return NextResponse.json({ ok: true });
}
