import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Message text is required" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: params.id,
      tenantId: session.user.tenantId,
    },
    include: {
      channel: true,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const client = getTwilioClient(
    conversation.channel.twilioAccountSid,
    conversation.channel.twilioAuthTokenEncrypted
  );

  let result: Awaited<ReturnType<typeof client.messages.create>>;

  try {
    result = await client.messages.create({
      from: conversation.channel.phoneNumberE164,
      to: conversation.externalThreadId,
      body: text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Twilio error";
    console.error("[send] Twilio error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    const now = new Date();

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          fromE164: conversation.channel.phoneNumberE164,
          toE164: conversation.externalThreadId,
          body: text,
          providerMessageId: result.sid,
          createdAt: now,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, status: "in_progress" },
      }),
      prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          userId: session.user.id,
          action: "conversation.send",
          payloadJson: {
            conversationId: conversation.id,
            messageSid: result.sid,
            to: conversation.externalThreadId,
          },
        },
      }),
    ]);
  } catch (err) {
    console.error("[send] DB error after successful Twilio send (sid=%s):", result.sid, err);
    return NextResponse.json({ error: "Message sent but failed to save — refresh the page." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
