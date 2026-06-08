import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTwilioClient } from "@/lib/twilio";
import { getGmailClient, fetchThread, sendGmailReply, extractEmail } from "@/lib/google";

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
      contact: true,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // ── Email channel ──────────────────────────────────────────────────────────
  if (conversation.channel.type === "email") {
    const channelEmail = conversation.channel.emailAddress;
    if (!channelEmail) {
      return NextResponse.json({ error: "Channel has no email address" }, { status: 500 });
    }

    // Resolve recipient — prefer saved contact, otherwise read from thread
    let recipientEmail = conversation.contact?.phoneE164 ?? "";

    let gmail: Awaited<ReturnType<typeof getGmailClient>>;
    try {
      gmail = await getGmailClient(conversation.channelId);
    } catch {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 503 });
    }

    let subject = "No subject";
    let inReplyTo: string | undefined;
    let references: string | undefined;

    try {
      const messages = await fetchThread(gmail, conversation.externalThreadId);
      if (messages.length > 0) {
        subject = messages[0].subject;
        const lastMsg = messages[messages.length - 1];
        inReplyTo = lastMsg.rfc822MessageId || undefined;
        references = lastMsg.rfc822MessageId || undefined;
        if (!recipientEmail) {
          // Find the last inbound message's sender
          const lastInbound = [...messages].reverse().find(
            (m) => extractEmail(m.from) !== channelEmail.toLowerCase()
          );
          recipientEmail = lastInbound ? extractEmail(lastInbound.from) : "";
        }
      }
    } catch (err) {
      console.error("[send/email] failed to fetch thread:", err);
      return NextResponse.json({ error: "Failed to fetch thread info from Gmail" }, { status: 502 });
    }

    if (!recipientEmail) {
      return NextResponse.json({ error: "Cannot determine recipient email address" }, { status: 400 });
    }

    let gmailMessageId: string;
    try {
      gmailMessageId = await sendGmailReply(gmail, {
        to: recipientEmail,
        from: channelEmail,
        subject,
        body: text,
        threadId: conversation.externalThreadId,
        inReplyTo,
        references,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gmail send error";
      console.error("[send/email] Gmail error:", err);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const now = new Date();
    try {
      await prisma.$transaction([
        prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: "outbound",
            fromE164: channelEmail,
            toE164: recipientEmail,
            body: text,
            providerMessageId: `gmail_${gmailMessageId}`,
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
              gmailMessageId,
              to: recipientEmail,
              channel: "email",
            },
          },
        }),
      ]);
    } catch (err) {
      console.error("[send/email] DB error after Gmail send (id=%s):", gmailMessageId, err);
      return NextResponse.json(
        { error: "Email sent but failed to save — refresh the page." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  }

  // ── SMS channel ────────────────────────────────────────────────────────────
  const phoneNumber = conversation.channel.phoneNumberE164;
  if (!phoneNumber) {
    return NextResponse.json({ error: "Channel has no phone number" }, { status: 500 });
  }

  const client = getTwilioClient(
    conversation.channel.twilioAccountSid,
    conversation.channel.twilioAuthTokenEncrypted
  );

  let result: Awaited<ReturnType<typeof client.messages.create>>;

  try {
    result = await client.messages.create({
      from: phoneNumber,
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
          fromE164: phoneNumber,
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
