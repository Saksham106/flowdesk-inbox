import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markGmailThreadRead } from "@/lib/google";

const VALID_STATUSES = ["needs_reply", "in_progress", "closed"] as const;
type Status = (typeof VALID_STATUSES)[number];

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const status = payload?.status as Status;

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();

  // Merge with existing metadata to preserve attentionCategory, emailType, action, etc.
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

  const mergedMeta = {
    ...prevMeta,
    userOverride: true,
    userState: status === "closed" ? "done" : status,
    updatedAt: now.toISOString(),
  };

  await prisma.conversation.update({
    where: { id: params.id },
    data: {
      status,
      userState: status === "closed" ? "done" : status,
      userStateSource: "user",
      userStateUpdatedAt: now,
      ...(status === "closed" ? { readAt: now, gmailUnread: false } : {}),
    },
  });

  await prisma.conversationState.upsert({
    where: { conversationId: params.id },
    create: {
      tenantId: session.user.tenantId,
      conversationId: params.id,
      state: status === "closed" ? "done" : status === "in_progress" ? "waiting_on_them" : "needs_reply",
      priority: status === "closed" ? "none" : "high",
      reason: status === "closed" ? "Conversation is done." : "User updated the conversation state.",
      nextAction: status === "closed" ? "No action needed." : "Review the conversation.",
      confidence: 1,
      source: "user_override",
      metadataJson: mergedMeta,
    },
    update: {
      state: status === "closed" ? "done" : status === "in_progress" ? "waiting_on_them" : "needs_reply",
      priority: status === "closed" ? "none" : "high",
      reason: status === "closed" ? "Conversation is done." : "User updated the conversation state.",
      nextAction: status === "closed" ? "No action needed." : "Review the conversation.",
      confidence: 1,
      source: "user_override",
      metadataJson: mergedMeta,
    },
  });

  if (status === "closed" && conversation.channelId) {
    const messages = await prisma.message.findMany({
      where: { conversationId: params.id },
      select: { providerMessageId: true },
    });
    await prisma.message.updateMany({
      where: { conversationId: params.id },
      data: { isRead: true },
    });
    markGmailThreadRead(conversation.channelId, messages.map((message) => message.providerMessageId), {
      tenantId: session.user.tenantId,
      conversationId: params.id,
    }).catch((err) => {
      console.warn("Failed to mark Gmail thread read after status update", {
        conversationId: params.id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    });
  }

  return NextResponse.json({ ok: true });
}
